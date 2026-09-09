import { db } from "@/lib/db";
import type { ShipmentStatus } from "@/lib/shipment-flow";

export interface DetailLike {
  actualWeightKg: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface ShipmentTotals {
  totalPackages: number;
  totalActualKg: number;
  totalVolumeM3: number;
}

/** Physical totals of a shipment: package count, actual kg, volume m³. */
export function computeTotals(details: DetailLike[]): ShipmentTotals {
  return {
    totalPackages: details.length,
    totalActualKg: details.reduce((sum, d) => sum + (d.actualWeightKg || 0), 0),
    totalVolumeM3:
      Math.round(details.reduce((sum, d) => sum + ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000, 0) * 1_000_000) / 1_000_000,
  };
}

export async function totalsByMaster(masterIds: number[]): Promise<Map<number, ShipmentTotals>> {
  if (masterIds.length === 0) return new Map();
  const details = await db.detailShipment.findMany({
    where: { masterId: { in: masterIds } },
    select: { masterId: true, actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true },
  });
  const map = new Map<number, { packages: number; kg: number; m3: number }>();
  for (const d of details) {
    const acc = map.get(d.masterId) ?? { packages: 0, kg: 0, m3: 0 };
    acc.packages += 1;
    acc.kg += d.actualWeightKg || 0;
    acc.m3 += ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000;
    map.set(d.masterId, acc);
  }
  const result = new Map<number, ShipmentTotals>();
  for (const [id, acc] of map) {
    result.set(id, {
      totalPackages: acc.packages,
      totalActualKg: Math.round(acc.kg * 100) / 100,
      totalVolumeM3: Math.round(acc.m3 * 1_000_000) / 1_000_000,
    });
  }
  return result;
}

/** Statuses counted as "Arrive at Gudang" in the shipments tab filter. */
export const GUDANG_ARRIVAL_STATUSES: ShipmentStatus[] = ["RECEIVED_AT_GUDANG", "ARRIVED_AT_GUDANG"];
