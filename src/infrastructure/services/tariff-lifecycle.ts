import { db } from "@/infrastructure/persistence/db";

/** Date fields are stored in UTC; a date-only expiry includes its final day. */
export function tariffEndDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setUTCHours(23, 59, 59, 999);
  return date;
}

/** Refresh persisted status in the current tenant before reading or reserving names. */
export async function expireTariffs(now = new Date()) {
  await db.tariff.updateMany({
    where: { isActive: true, effectiveTo: { lt: now } },
    data: { isActive: false },
  });
}

export function isTariffConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
