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

/** Next detail code within a shipment: DTL-xxxxxx-nn */
export async function nextDetailCode(masterId: number, masterCode: string): Promise<string> {
  const codes = await nextDetailCodes(masterId, masterCode, 1);
  return codes[0];
}

/** Bulk next detail codes for one shipment: DTL-xxxxxx-nn .. DTL-xxxxxx-(nn+count-1).
 *  Used when a detail input with quantity N expands into N package rows. */
export async function nextDetailCodes(masterId: number, masterCode: string, count: number): Promise<string[]> {
  const details = await db.detailShipment.findMany({ where: { masterId }, select: { detailCode: true } });
  const base = masterCode.replace("MKT", "DTL");
  let max = 0;
  for (const d of details) {
    const match = d.detailCode.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const n = Math.max(1, Math.min(count, 500));
  return Array.from({ length: n }, (_, i) => `${base}-${String(max + 1 + i).padStart(2, "0")}`);
}
