import { describe, it, expect } from "vitest";
import { parseBankAccount } from "@/domain/bank-account";
import { validateExpense, summarizeExpenses } from "@/domain/transport-ops";

const bank = { bankName: "BCA", accountNumber: "0012345678", accountName: "PT KirimKu" };
describe("Master Rekening validation", () => {
  it("keeps leading zeroes and normalizes account separators", () => {
    expect(parseBankAccount({ ...bank, accountNumber: "00 123-45678" })).toEqual({ ...bank, isActive: true });
  });
  it.each([null, [], { ...bank, bankName: " " }, { ...bank, accountName: "" }, { ...bank, accountNumber: 12345678 }, { ...bank, accountNumber: "123A" }, { ...bank, isActive: "false" }])("rejects invalid input %j", input => {
    expect(typeof parseBankAccount(input)).toBe("string");
  });
  it("permits explicitly deactivated accounts", () => expect(parseBankAccount({ ...bank, isActive: false })).toMatchObject({ isActive: false }));
});
describe("Biaya Angkut", () => {
  it("accepts ANGKUT and only includes approved amounts in approved spend", () => {
    expect(validateExpense({ type: "ANGKUT", amount: 150_000 })).toBeNull();
    const summary = summarizeExpenses([{ type: "ANGKUT", amount: 150_000, status: "APPROVED" }, { type: "ANGKUT", amount: 50_000, status: "PENDING" }, { type: "BBM", amount: 100_000, status: "APPROVED" }]);
    expect(summary.total).toBe(250_000);
    expect(summary.byType.ANGKUT).toEqual({ count: 1, total: 150_000 });
  });
});
