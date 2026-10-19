import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ group: vi.fn(), aggregate: vi.fn(), invoices: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { payment: { groupBy: m.group, aggregate: m.aggregate }, invoice: { findMany: m.invoices } } }));
import { customerIncomeSummary } from "@/infrastructure/services/customer-income";
beforeEach(() => {
  vi.clearAllMocks();
  m.group.mockResolvedValue([{ method: "CASH", _sum: { amount: 100_000 } }, { method: "TRANSFER", _sum: { amount: 200_000 } }]);
  m.aggregate.mockResolvedValue({ _sum: { amount: 50_000 } });
  m.invoices.mockResolvedValue([{ discount: 10_000, rounding: 100, lines: [{ quantity: 2, unitPrice: 100_000 }], settlements: [{ amount: 50_000 }] }, { discount: 0, rounding: 0, lines: [{ quantity: 1, unitPrice: 100_000 }], settlements: [{ amount: 100_000 }] }]);
});
describe("customer receipts in Finance", () => {
  it("separates verified B2C cash and transfer, pending amounts and B2B receivables", async () => {
    expect(await customerIncomeSummary()).toEqual({ b2cReceived: 300_000, b2cCash: 100_000, b2cTransfer: 200_000, b2cPending: 50_000, b2bOutstanding: 140_100 });
    expect(m.group).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "VERIFIED", master: expect.objectContaining({ customer: { type: "b2c" } }) }) }));
    expect(m.invoices).toHaveBeenCalledWith(expect.objectContaining({ where: { customer: { type: "b2b" }, status: { in: ["SENT", "PARTIALLY_SETTLED", "SETTLED"] } } }));
  });
  it("does not create a receivable for overpaid invoices or absent payments", async () => {
    m.group.mockResolvedValue([]); m.aggregate.mockResolvedValue({ _sum: { amount: null } });
    m.invoices.mockResolvedValue([{ discount: 0, rounding: 0, lines: [{ quantity: 1, unitPrice: 100 }], settlements: [{ amount: 200 }] }]);
    expect(await customerIncomeSummary()).toMatchObject({ b2cReceived: 0, b2cCash: 0, b2cTransfer: 0, b2cPending: 0, b2bOutstanding: 0 });
  });
});
