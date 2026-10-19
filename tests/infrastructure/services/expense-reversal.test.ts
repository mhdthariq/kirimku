import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), update: vi.fn(), remove: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/auth/auth", () => ({ hasPermission: m.permission }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ transportExpense: { updateMany: m.update, deleteMany: m.remove }, auditLog: { create: m.audit } }) } }));
import { reverseExpense } from "@/infrastructure/services/expense-reversal";
import type { AuthUser } from "@/infrastructure/auth/auth";
const user = { id: 7 } as AuthUser;
const expense = { id: 1, status: "APPROVED", expenseCode: "EXP-1", amount: 100_000, approvedByUsername: "approver" };
beforeEach(() => { vi.resetAllMocks(); m.permission.mockReturnValue(true); m.update.mockResolvedValue({ count: 1 }); m.remove.mockResolvedValue({ count: 1 }); });
describe("approved expense reversal", () => {
  it("requires the dedicated delete permission", async () => {
    m.permission.mockReturnValue(false);
    await expect(reverseExpense(user, expense, "remove", "duplicate")).rejects.toMatchObject({ status: 403 });
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("allows a delegated deleter without granting approval or cancellation", async () => {
    m.permission.mockImplementation((_user, permission) => permission === "transport.expense.delete");
    await expect(reverseExpense(user, expense, "remove", "duplicate")).resolves.toEqual({ status: "REMOVED" });
    await expect(reverseExpense(user, expense, "cancel", "duplicate")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["", "   ", null, "x".repeat(1001)])("requires a bounded nonblank reason %#", async reason => {
    await expect(reverseExpense(user, expense, "cancel", reason)).rejects.toMatchObject({ status: 422 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("keeps a cancelled entry and its approval snapshot, with an audit reason", async () => {
    await expect(reverseExpense(user, expense, "cancel", "  duplicate  ")).resolves.toEqual({ status: "CANCELLED" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: 1, status: "APPROVED" }, data: { status: "CANCELLED", cancelledAt: expect.any(Date), cancelledById: 7, cancellationReason: "duplicate" } });
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 7, afterData: JSON.stringify({ reason: "duplicate", status: "CANCELLED" }) }) });
  });
  it("removes approved expenses and preserves the amount, approver and reason in mandatory audit", async () => {
    await reverseExpense(user, expense, "remove", "wrong receipt");
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 1, status: "APPROVED" } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ beforeData: JSON.stringify(expense), afterData: JSON.stringify({ reason: "wrong receipt", status: "REMOVED" }) }) });
  });
  it("rejects concurrent changes without recording a false cancellation", async () => {
    m.update.mockResolvedValue({ count: 0 });
    await expect(reverseExpense(user, expense, "cancel", "duplicate")).rejects.toMatchObject({ status: 409 });
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("fails when the mandatory audit cannot persist", async () => {
    m.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(reverseExpense(user, expense, "remove", "duplicate")).rejects.toThrow("audit unavailable");
  });
  it("cannot approve or cancel a cancelled expense again", async () => {
    await expect(reverseExpense(user, { ...expense, status: "CANCELLED" }, "cancel", "again")).rejects.toMatchObject({ status: 409 });
  });
});
