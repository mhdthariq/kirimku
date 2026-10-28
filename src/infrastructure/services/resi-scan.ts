import { parseResiQrUrl } from "@/shared/resi-qr";
import { HttpError } from "@/shared/http-error";

/** Accept existing bare codes and new QR links, while enforcing tenant identity. */
export function normalizeResiScan(value: string, corporateId: string | null): string {
  const qr = parseResiQrUrl(value.trim());
  if (!qr) return value.trim();
  if (qr.corporateId !== (corporateId?.trim() || "LOCAL")) {
    throw new HttpError(422, "QR resi berasal dari corporate yang berbeda.");
  }
  return qr.resi;
}
