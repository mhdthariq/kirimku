import { dateOrNull, requireNum, str } from "@/composition/api-helpers";
import { HttpError } from "@/shared/http-error";
import type { SettlementInput } from "@/infrastructure/services/invoice-settlements";

export function settlementInput(body: Record<string, unknown>): SettlementInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(422, "Data settlement tidak valid.");
  // Whether zero is allowed depends on the invoice total, checked in the transaction.
  const amount = requireNum(body.amount, "amount", 0);
  if (amount > 0 && amount < 0.01) throw new HttpError(422, "Jumlah pembayaran minimal 0.01.");
  const pph = body.pph == null || body.pph === "" ? 0 : requireNum(body.pph, "pph", 0);
  if (pph > amount) throw new HttpError(422, "PPh tidak boleh melebihi jumlah pembayaran.");
  if (body.method !== "TRANSFER" && body.method !== "CASH") throw new HttpError(422, "Metode pembayaran tidak valid.");
  const settledAt = dateOrNull(body.settledAt);
  if (body.settledAt && !settledAt) throw new HttpError(422, "Tanggal pembayaran tidak valid.");
  const proofUrl = str(body.proofUrl);
  if (proofUrl && (!/^data:(image\/[a-zA-Z0-9.+-]+|application\/pdf);base64,/.test(proofUrl) || proofUrl.length > 12_000_000)) throw new HttpError(422, "Bukti pembayaran harus gambar/PDF, maksimal 8 MB.");
  return { amount, pph, method: body.method, reference: str(body.reference), settledAt: settledAt ?? new Date(), ...(body.proofUrl !== undefined ? { proofUrl } : {}) };
}
