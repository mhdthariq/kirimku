export interface BankAccountInput {
  bankName: string;
  accountNumber: string;
  accountName: string;
  isActive: boolean;
}

export function parseBankAccount(value: unknown): BankAccountInput | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Data rekening tidak valid.";
  const body = value as Record<string, unknown>;
  const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/[\s-]/g, "") : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  if (!bankName || bankName.length > 100) return "Nama bank wajib diisi, maksimal 100 karakter.";
  if (!/^\d{4,40}$/.test(accountNumber)) return "No. rekening harus 4–40 digit angka.";
  if (!accountName || accountName.length > 150) return "Nama rekening wajib diisi, maksimal 150 karakter.";
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") return "Status aktif rekening tidak valid.";
  return { bankName, accountNumber, accountName, isActive: body.isActive !== false };
}
