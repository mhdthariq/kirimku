import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { detailAggregates, transportLoadFromAggregates } from "@/lib/transport-totals";
import { calculateTransportCapacityStatus } from "@/lib/capacity";
import { getCapacityWarningThreshold } from "@/lib/settings";

/**
 * GET /api/v1/fleet-capacity — Fleet Capacity overview (Capacity Round).
 *
 * Returns every vehicle with its capacity config (maxWeightKg / maxVolumeM3 /
 * maxKoli) and the LIVE capacity status of the cargo currently assigned to its
 * active (PLANNED + DEPARTED) transports. A vehicle with no active transport
 * returns `activeLoad: null` and `activeCapacity: null`.
 *
 * Informational only — never blocks operations. Gated on `vehicle.view`.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "vehicle.view");

    const vehicles = await db.vehicle.findMany({
      orderBy: [{ status: "asc" }, { vehicleNumber: "asc" }],
      include: {
        owner: { include: { user: { select: { name: true } } } },
        transports: {
          where: { status: { in: ["PLANNED", "DEPARTED"] } },
          include: { shipments: { include: { master: true } } },
        },
      },
    });

    // One detailAggregates call for ALL active transports' masters.
    const allMasterIds = vehicles.flatMap((v) => v.transports.flatMap((t) => t.shipments.map((s) => s.shipmentId)));
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(allMasterIds);
    const warningThreshold = await getCapacityWarningThreshold();

    const rows = vehicles.map((v) => {
      // Aggregate the load across ALL active transports of this vehicle.
      const masters = v.transports.flatMap((t) => t.shipments.map((s) => ({ id: s.shipmentId, chargeableWeightKg: null, priceAmount: null })));
      const hasActive = v.transports.length > 0;
      const load = hasActive ? transportLoadFromAggregates(masters, volumeByMaster, actualKgByMaster, packagesByMaster) : null;
      const capacity = hasActive && load
        ? calculateTransportCapacityStatus(
            { maxWeightKg: v.maxWeightKg, maxVolumeM3: v.maxVolumeM3, maxKoli: v.maxKoli },
            load,
            warningThreshold,
          )
        : null;
      return {
        id: v.id,
        vehicleNumber: v.vehicleNumber,
        name: v.name,
        status: v.status,
        maxWeightKg: v.maxWeightKg,
        maxVolumeM3: v.maxVolumeM3,
        maxKoli: v.maxKoli,
        lengthM: v.lengthM,
        widthM: v.widthM,
        heightM: v.heightM,
        ownerId: v.ownerId,
        ownerName: v.owner?.user.name ?? null,
        activeTransportCount: v.transports.length,
        activeLoad: load,
        activeCapacity: capacity,
      };
    });

    // Fleet-wide summary counts.
    const activeVehicles = rows.filter((r) => r.activeCapacity != null);
    const summary = {
      total: rows.length,
      active: activeVehicles.length,
      idle: rows.length - activeVehicles.length,
      overCapacity: activeVehicles.filter((r) => r.activeCapacity?.overallStatus === "OVERLIMIT").length,
      warning: activeVehicles.filter((r) => r.activeCapacity?.overallStatus === "WARNING").length,
      partiallyConfigured: activeVehicles.filter((r) => r.activeCapacity?.overallStatus === "PARTIALLY_CONFIGURED").length,
      ok: activeVehicles.filter((r) => r.activeCapacity?.overallStatus === "OK").length,
      unconfiguredVehicles: rows.filter((r) => r.maxKoli == null).length,
    };

    return ok({ vehicles: rows, summary });
  });
}
