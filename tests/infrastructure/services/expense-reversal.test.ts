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
  it.each(["APPROVED", "CANCELLED"])("allows special deletion alone for %s without granting cancellation", async status => {
    m.permission.mockImplementation((_user, permission) => permission === "transport.expense.delete-approved");
    await expect(reverseExpense(user, { ...expense, status }, "remove", "duplicate")).resolves.toEqual({ status: "REMOVED" });
    expect(m.permission).toHaveBeenCalledWith(user, "transport.expense.delete-approved");
    expect(m.remove).toHaveBeenCalledWith({ where: { id: expense.id, status } });
    await expect(reverseExpense(user, expense, "cancel", "duplicate")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["APPROVED", "CANCELLED"])("denies regular deletion and/or approval for %s removal", async status => {
    for (const permissions of [["transport.expense.delete"], ["transport.expense.approve"], ["transport.expense.delete", "transport.expense.approve"]]) {
      m.permission.mockImplementation((_user, permission) => permissions.includes(permission));
      await expect(reverseExpense(user, { ...expense, status }, "remove", "duplicate")).rejects.toMatchObject({ status: 403, message: "Missing permission: transport.expense.delete-approved" });
    }
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "REJECTED"])("does not allow special removal of %s", async status => {
    await expect(reverseExpense(user, { ...expense, status }, "remove", "duplicate")).rejects.toMatchObject({ status: 409 });
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "CANCELLED"])("requires a bounded reason before removing %s", async status => {
    for (const reason of ["", "   ", null, "x".repeat(1001)]) {
      await expect(reverseExpense(user, { ...expense, status }, "remove", reason)).rejects.toMatchObject({ status: 422 });
    }
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
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
  it.each(["APPROVED", "CANCELLED"])("removes %s and preserves the amount, approver and trimmed reason in mandatory audit", async status => {
    const snapshot = { ...expense, status };
    await reverseExpense(user, snapshot, "remove", "  wrong receipt  ");
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 1, status } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "remove", entityType: "transport_expense", entityId: 1, actorId: user.id, beforeData: JSON.stringify(snapshot), afterData: JSON.stringify({ reason: "wrong receipt", status: "REMOVED" }) }) });
  });
  it("rejects concurrent changes without recording a false cancellation", async () => {
    m.update.mockResolvedValue({ count: 0 });
    await expect(reverseExpense(user, expense, "cancel", "duplicate")).rejects.toMatchObject({ status: 409 });
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("rejects concurrent removal without recording a false audit", async () => {
    m.remove.mockResolvedValue({ count: 0 });
    await expect(reverseExpense(user, expense, "remove", "duplicate")).rejects.toMatchObject({ status: 409 });
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
