import { db } from "@/lib/db";

/**
 * Compute the next sequential code by scanning the max numeric suffix of
 * existing codes. Robust against seeded/gapped sequences (unlike count()+1
 * which collides when codes don't start at 1 or contain gaps).
 */
export async function nextCode(
  model: "pickup" | "transport" | "delivery" | "invoice" | "masterShipment" | "detailShipment" | "warehouse" | "customer" | "employee",
  prefix: string,
  field: "pickupCode" | "transportCode" | "deliveryCode" | "invoiceNumber" | "masterCode" | "detailCode" | "code" | "employeeNumber" = "code",
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
  const seq = Math.max(max + 1, fallbackStart);
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/** Next detail code within a shipment: DTL-xxxxxx-nn */
export async function nextDetailCode(masterId: number, masterCode: string): Promise<string> {
  const details = await db.detailShipment.findMany({ where: { masterId }, select: { detailCode: true } });
  const base = masterCode.replace("MKT", "DTL");
  let max = 0;
  for (const d of details) {
    const match = d.detailCode.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${base}-${String(max + 1).padStart(2, "0")}`;
}
