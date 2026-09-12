import { db } from "@/lib/db";

/**
 * Compute the next sequential code by scanning the max numeric suffix of
 * existing codes. Robust against seeded/gapped sequences (unlike count()+1
 * which collides when codes don't start at 1 or contain gaps).
 */
export async function nextCode(
  model: "pickup" | "transport" | "delivery" | "invoice" | "masterShipment" | "detailShipment" | "warehouse" | "customer" | "employee" | "topUpRequest" | "withdrawalRequest" | "vehicleRepair" | "transportSettlement" | "marketingCommission",
  prefix: string,
  field: "pickupCode" | "transportCode" | "deliveryCode" | "invoiceNumber" | "masterCode" | "detailCode" | "code" | "employeeNumber" | "requestCode" | "repairCode" | "settlementCode" | "commissionCode" = "code",
  fallbackStart = 1,
): Promise<string> {
  const rows: { code: string }[] = await (db as any)[model].findMany({
    select: { [field]: true },
  }).then((list: Record<string, string>[]) => list.map((r) => ({ code: String(r[field]) })));

  let max = 0;
  for (const row of rows) {
    const match = row.code.match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const key = `${model}:${field}:${prefix}`;
  const sequence = await db.codeSequence.upsert({
    where: { key },
    create: { key, nextValue: Math.max(max + 2, fallbackStart + 1) },
    update: { nextValue: { increment: 1 } },
  });
  const seq = sequence.nextValue - 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/**
 * Generate package codes as DTL-YYYYMMDD-HHmmss-NNN.
 * NNN is the package order for the current day, shared across shipments.
 */
export async function nextDetailCode(masterId: number, masterCode: string): Promise<string> {
  const codes = await nextDetailCodes(masterId, masterCode, 1);
  return codes[0];
}

/** Bulk next package codes for one input: DTL-YYYYMMDD-HHmmss-NNN .. NNN+count-1. */
export async function nextDetailCodes(masterId: number, masterCode: string, count: number): Promise<string[]> {
  void masterId;
  void masterCode;
  const n = Math.max(1, Math.min(count, 500));
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const prefix = `DTL-${date}-${time}-`;
  const datePrefix = `DTL-${date}-`;

  // Seed the daily counter from existing codes so this also works against a
  // database that already contains package codes created earlier today.
  const existing = await db.detailShipment.findMany({
    where: { detailCode: { startsWith: datePrefix } },
    select: { detailCode: true },
  });
  let max = 0;
  for (const detail of existing) {
    const match = detail.detailCode.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }

  const key = `detailShipment:daily:${date}`;
  const sequence = await db.codeSequence.upsert({
    where: { key },
    create: { key, nextValue: Math.max(max + n + 1, n + 1) },
    update: { nextValue: { increment: n } },
  });
  const first = sequence.nextValue - n;
  return Array.from({ length: n }, (_, i) => `${prefix}${String(first + i).padStart(3, "0")}`);
}
