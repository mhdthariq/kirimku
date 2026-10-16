import { describe, it, beforeEach, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { bankAccount: { findUnique: m.find } } }));
import { invoiceBankSnapshot } from "@/infrastructure/services/invoice-bank-account";
beforeEach(() => vi.clearAllMocks());
describe("invoice bank snapshots", () => {
  it("leaves existing invoices without a chosen bank unchanged", async () => {
    expect(await invoiceBankSnapshot(null)).toEqual({ bankAccountId: null, paymentBankName: null, paymentAccountNumber: null, paymentAccountName: null });
    expect(m.find).not.toHaveBeenCalled();
  });
  it("copies just the account selection and three payment fields", async () => {
    const bank = { id: 1, bankName: "BCA", accountNumber: "00123456", accountName: "PT KirimKu", isActive: true };
    m.find.mockResolvedValue(bank);
    const snapshot = await invoiceBankSnapshot(1);
    bank.accountNumber = "99999999";
    expect(snapshot).toEqual({ bankAccountId: 1, paymentBankName: "BCA", paymentAccountNumber: "00123456", paymentAccountName: "PT KirimKu" });
  });
  it.each([null, { id: 1, isActive: false }])("rejects missing/inactive bank %j", async bank => {
    m.find.mockResolvedValue(bank);
    await expect(invoiceBankSnapshot(1)).rejects.toMatchObject({ status: 422 });
  });
  it.each([0, -1, 1.5, true, {}, "bad"])("rejects invalid account ID %j", async id => {
    await expect(invoiceBankSnapshot(id)).rejects.toMatchObject({ status: 422 });
    expect(m.find).not.toHaveBeenCalled();
  });
});
