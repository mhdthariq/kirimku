import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Transport aggregate calculations (Revision Part L).
 *
 * Rules (consistent with the rest of the system):
 * - Total Berat  = SUM of each shipment's chargeable weight — the final
 *   chargeable kg recorded by the shipment system (chargeableWeightKg); when
 *   a shipment has not been priced yet, fall back to the sum of its actual
 *   package weights so the number is still meaningful.
 * - Total Volume = SUM of shipment volumes using the existing kubikasi
 *   calculation (L×W×H cm / 1.000.000 per detail package).
 * - Total Price  = SUM of each shipment's final recorded price (priceAmount) —
 *   prices are NEVER recalculated here.
 *
 * Everything is computed with database aggregation (a groupBy over the
 * detail rows of the involved shipments) rather than loading every package
 * into the frontend.
 */

export interface TransportAggregates {
  shipmentCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  totalPrice: number | null;
}

interface MasterLike {
  id: number;
  chargeableWeightKg: number | null;
  priceAmount: number | null;
}

/** Aggregate one transport from its shipment masters (+ detail groupBy data). */
export function aggregateTransport(
  masters: MasterLike[],
  volumeByMaster: Map<number, number>,
  actualKgByMaster: Map<number, number>,
): TransportAggregates {
  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  let priceSum = 0;
  let pricedCount = 0;
  for (const m of masters) {
    totalWeightKg += m.chargeableWeightKg ?? actualKgByMaster.get(m.id) ?? 0;
    totalVolumeM3 += volumeByMaster.get(m.id) ?? 0;
    if (m.priceAmount != null) {
      priceSum += m.priceAmount;
      pricedCount += 1;
    }
  }
  return {
    shipmentCount: masters.length,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    totalVolumeM3: Math.round(totalVolumeM3 * 1_000_000) / 1_000_000,
    // null when no shipment is priced — the UI shows "—"
    totalPrice: pricedCount > 0 ? priceSum : null,
  };
}

/**
 * Volume (kubikasi m³) + actual kg per master, aggregated in the DATABASE
 * (groupBy over detail shipments) — one query for any set of masters.
 */
export async function detailAggregates(masterIds: number[]): Promise<{
  volumeByMaster: Map<number, number>;
  actualKgByMaster: Map<number, number>;
  packagesByMaster: Map<number, number>;
}> {
  if (masterIds.length === 0) {
    return { volumeByMaster: new Map(), actualKgByMaster: new Map(), packagesByMaster: new Map() };
  }
  const grouped = await db.detailShipment.groupBy({
    by: ["masterId"],
    where: { masterId: { in: masterIds } },
    _sum: { actualWeightKg: true },
    _count: { _all: true },
  });
  // Volumetric aggregation needs a computed expression — one parameterized
  // raw query (COALESCE guards null dimensions), identical on SQLite & PG.
  const rows = await db.$queryRaw<{ masterId: number; volumeM3: number | null }[]>(Prisma.sql`
    SELECT "masterId", SUM(
      (COALESCE("lengthCm", 0) * COALESCE("widthCm", 0) * COALESCE("heightCm", 0)) / 1000000.0
    ) AS "volumeM3"
    FROM "DetailShipment"
    WHERE "masterId" IN (${Prisma.join(masterIds)})
    GROUP BY "masterId"
  `);

  const volumeByMaster = new Map<number, number>();
  for (const r of rows) volumeByMaster.set(Number(r.masterId), Math.round((r.volumeM3 ?? 0) * 1_000_000) / 1_000_000);
  const actualKgByMaster = new Map<number, number>();
  const packagesByMaster = new Map<number, number>();
  for (const g of grouped) {
    actualKgByMaster.set(g.masterId, Math.round((g._sum.actualWeightKg ?? 0) * 100) / 100);
    packagesByMaster.set(g.masterId, g._count._all);
  }
  return { volumeByMaster, actualKgByMaster, packagesByMaster };
}

/**
 * Revision Part Y — server-side authorization helper:
 * users who can only VIEW transports (driver / kenek without planning
 * permissions) are restricted to transports assigned to THEM (driverId or
 * kenekId = their employee id). The frontend never hides rows as a security
 * mechanism — the backend filters.
 */
export function isExecutorOnly(user: { isOwner: boolean; permissions: string[] }): boolean {
  if (user.isOwner || user.permissions.includes("*")) return false;
  const has = (slug: string) => user.permissions.includes(slug);
  return !has("transport.create") && !has("transport.depart") && !has("transport.arrive");
}

/** Haversine distance in METERS between two coordinates. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** meters → km rounded to 2 decimals (display helper). */
export function metersToKmDisplay(meters: number): number {
  return Math.round((meters / 1000) * 100) / 100;
}
