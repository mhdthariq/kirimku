import { db } from "@/infrastructure/persistence/db";
import { HttpError } from "@/shared/http-error";

/** Copy payment instructions so master-data edits never rewrite historical invoices. */
export async function invoiceBankSnapshot(value: unknown) {
  if (value == null || value === "") return { bankAccountId: null, paymentBankName: null, paymentAccountNumber: null, paymentAccountName: null };
  const id = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(422, "Rekening tidak valid.");
  const account = await db.bankAccount.findUnique({ where: { id } });
  if (!account || !account.isActive) throw new HttpError(422, "Rekening tidak ditemukan atau sudah nonaktif.");
  return { bankAccountId: account.id, paymentBankName: account.bankName, paymentAccountNumber: account.accountNumber, paymentAccountName: account.accountName };
}
