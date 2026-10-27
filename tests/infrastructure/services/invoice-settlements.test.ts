import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  invoiceFind: vi.fn(), invoiceUpdate: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  walletFind: vi.fn(), walletCreate: vi.fn(), walletUpdate: vi.fn(), ledger: vi.fn(), commissionUpdate: vi.fn(), reserved: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => {
  const tx = {
    invoice: { findUnique: m.invoiceFind, update: m.invoiceUpdate },
    invoiceSettlement: { create: m.create, update: m.update, delete: m.remove },
    wallet: { findUnique: m.walletFind, create: m.walletCreate, update: m.walletUpdate },
    walletTransaction: { create: m.ledger }, marketingCommission: { update: m.commissionUpdate },
    withdrawalRequest: { aggregate: m.reserved },
  };
  m.transaction.mockImplementation((fn: (db: typeof tx) => unknown) => fn(tx));
  return { db: { $transaction: m.transaction } };
});
import { mutateInvoiceSettlement, type SettlementInput } from "@/infrastructure/services/invoice-settlements";

const input: SettlementInput = { amount: 500_000, pph: 5_000, method: "TRANSFER", reference: "REF", settledAt: new Date("2026-10-16") };
const payment = { ...input, id: 10, invoiceId: 1, proofUrl: "data:application/pdf;base64,AAAA", recordedById: 2 };
const commission = { id: 3, partnerId: 4, commissionAmount: 50_000, status: "PENDING" };
function invoice(overrides = {}) {
  return { id: 1, invoiceNumber: "INV-1", status: "SENT", discount: 0, rounding: 0, lines: [{ quantity: 1, unitPrice: 500_000 }], settlements: [], commission: null, ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.invoiceFind.mockResolvedValue(invoice());
  m.invoiceUpdate.mockImplementation(async ({ data }) => ({ id: 1, invoiceNumber: "INV-1", ...data }));
  m.create.mockResolvedValue(payment);
  m.update.mockResolvedValue(payment);
  m.walletFind.mockResolvedValue({ id: 5, balance: 100_000 });
  m.reserved.mockResolvedValue({ _sum: { amount: 0 } });
  m.ledger.mockResolvedValue({ id: 20 });
});

describe("invoice settlements with informational PPh", () => {
  it("settles a fully discounted zero-total invoice and records the zero settlement", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ discount: 500_000, commission }));
    const zeroInput = { ...input, amount: 0, pph: 0 };
    const result = await mutateInvoiceSettlement(1, 2, { type: "create", input: zeroInput });
    expect(result.invoice.status).toBe("SETTLED");
    expect(m.create).toHaveBeenCalledWith({ data: { ...zeroInput, invoiceId: 1, recordedById: 2 } });
    expect(result.commissionReleased).toBe(true);
  });
  it("rejects a zero settlement for a positive-total invoice", async () => {
    await expect(mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 0, pph: 0 } })).rejects.toMatchObject({ status: 422 });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects duplicate settlement of an already settled zero-total invoice", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ discount: 500_000, status: "SETTLED", settlements: [{ ...payment, amount: 0, pph: 0 }] }));
    await expect(mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 0, pph: 0 } })).rejects.toMatchObject({ status: 422 });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("allows editing and deleting a zero settlement", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ discount: 500_000, status: "SETTLED", settlements: [{ ...payment, amount: 0, pph: 0 }] }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "update", settlementId: 10, input: { ...input, amount: 0, pph: 0, reference: "Updated" } })).invoice.status).toBe("SETTLED");
    expect((await mutateInvoiceSettlement(1, 2, { type: "delete", settlementId: 10 })).invoice.status).toBe("SENT");
  });
  it("settles a 500,000 invoice with transfer 500,000 and PPh 5,000", async () => {
    const result = await mutateInvoiceSettlement(1, 2, { type: "create", input });
    expect(result.invoice.status).toBe("SETTLED");
    expect(m.create).toHaveBeenCalledWith({ data: { ...input, invoiceId: 1, recordedById: 2 } });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("keeps a partial transfer partial and counts old PPh payments at full amount", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ settlements: [{ ...payment, amount: 200_000 }], commission }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 100_000 } })).invoice.status).toBe("PARTIALLY_SETTLED");
    expect(m.ledger).not.toHaveBeenCalled();
    expect((await mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 300_000 } })).invoice.status).toBe("SETTLED");
    expect(m.ledger).toHaveBeenCalledOnce();
  });
  it("rejects overpayment even when PPh would previously have hidden it", async () => {
    await expect(mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 505_000 } })).rejects.toMatchObject({ status: 422 });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("includes existing invoice rounding in the amount due", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ rounding: -1_000 }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "create", input: { ...input, amount: 499_000 } })).invoice.status).toBe("SETTLED");
  });
  it("editing PPh alone preserves full settlement and does not release commission twice", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ status: "SETTLED", settlements: [payment], commission: { ...commission, status: "RELEASED" } }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "update", settlementId: 10, input: { ...input, pph: 10_000 } })).invoice.status).toBe("SETTLED");
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("proofUrl");
    expect(m.ledger).not.toHaveBeenCalled();
  });
  it("reducing payment reopens invoice and appends a commission reversal", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ status: "SETTLED", settlements: [payment], commission: { ...commission, status: "RELEASED" } }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "update", settlementId: 10, input: { ...input, amount: 400_000 } })).invoice.status).toBe("PARTIALLY_SETTLED");
    expect(m.ledger).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "ADJUSTMENT", direction: "DEBIT", amount: 50_000, balanceAfter: 50_000 }) });
    expect(m.commissionUpdate).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: "PENDING", releasedAt: null, walletTransactionId: null } });
  });
  it("deleting the last payment returns invoice to SENT", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ status: "SETTLED", settlements: [payment] }));
    const result = await mutateInvoiceSettlement(1, 2, { type: "delete", settlementId: 10 });
    expect(result.invoice.status).toBe("SENT");
    expect(result.previous).toEqual(payment);
  });
  it("deleting one of several payments leaves the others intact", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ status: "SETTLED", settlements: [{ ...payment, amount: 200_000 }, { ...payment, id: 11, amount: 300_000 }] }));
    expect((await mutateInvoiceSettlement(1, 2, { type: "delete", settlementId: 10 })).invoice.status).toBe("PARTIALLY_SETTLED");
    expect(m.remove).toHaveBeenCalledExactlyOnceWith({ where: { id: 10 } });
  });
  it.each(["update", "delete"] as const)("scopes %s to this invoice", async (type) => {
    await expect(mutateInvoiceSettlement(1, 2, { type, settlementId: 99, input })).rejects.toMatchObject({ status: 404 });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.remove).not.toHaveBeenCalled();
  });
  it.each(["DRAFT", "CANCELLED"])("rejects changes to %s invoices", async (status) => {
    m.invoiceFind.mockResolvedValue(invoice({ status }));
    await expect(mutateInvoiceSettlement(1, 2, { type: "create", input })).rejects.toMatchObject({ status: 422 });
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([{ balance: 10_000, reserved: 0 }, { balance: 100_000, reserved: 75_000 }])("rejects reversal when funds are spent or reserved (%j)", async ({ balance, reserved }) => {
    m.invoiceFind.mockResolvedValue(invoice({ status: "SETTLED", settlements: [payment], commission: { ...commission, status: "RELEASED" } }));
    m.walletFind.mockResolvedValue({ id: 5, balance });
    m.reserved.mockResolvedValue({ _sum: { amount: reserved } });
    await expect(mutateInvoiceSettlement(1, 2, { type: "delete", settlementId: 10 })).rejects.toMatchObject({ status: 422 });
    expect(m.ledger).not.toHaveBeenCalled();
    expect(m.commissionUpdate).not.toHaveBeenCalled();
  });
  it("releases commission after correction and re-settlement", async () => {
    m.invoiceFind.mockResolvedValue(invoice({ commission }));
    await mutateInvoiceSettlement(1, 2, { type: "create", input });
    expect(m.ledger).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "COMMISSION", direction: "CREDIT", balanceAfter: 150_000 }) });
    expect(m.commissionUpdate).toHaveBeenCalledWith({ where: { id: 3 }, data: expect.objectContaining({ status: "RELEASED", walletTransactionId: 20 }) });
  });
  it("returns a retryable conflict when concurrent writes collide", async () => {
    m.invoiceFind.mockRejectedValueOnce({ code: "P2034" });
    await expect(mutateInvoiceSettlement(1, 2, { type: "create", input })).rejects.toMatchObject({ status: 409 });
  });
});
