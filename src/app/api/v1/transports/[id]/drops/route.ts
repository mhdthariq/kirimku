import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { dropProgress, effectiveDropCheckpointId, groupByDropCheckpoint, isVehicleEmpty, normalizeTransportMode } from "@/lib/transport-ops";
import { assertTransportAccess } from "@/lib/transport-ops-server";
import { detailAggregates, transportLoadFromAggregates } from "@/lib/transport-totals";
import { calculateTransportCapacityStatus } from "@/lib/capacity";
import { getCapacityWarningThreshold } from "@/lib/settings";

type Params = { params: Promise<{ id: string }> };

/** GET /transports/:id/drops — the multi drop board: checkpoints, resi per drop point, progress.
 *
 * Capacity Round (plan §18) — also returns a `loadSummary` with the initial load
 * (all assigned cargo), the remaining load (cargo still on the vehicle = not
 * yet DROPPED), and the vehicle capacity status against the remaining load.
 * This lets the crew see how much cargo is still aboard after each drop.
 */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        vehicle: true,
        route: { include: { checkpoints: { where: { isActive: true }, orderBy: { sequence: "asc" } } } },
        checkpointRecords: { select: { checkpointId: true } },
        shipments: { include: { master: { include: { customer: { select: { name: true, companyName: true } } } } } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);

    const checkpoints = transport.route?.checkpoints ?? [];
    const finalId = checkpoints.length ? checkpoints[checkpoints.length - 1].id : null;
    const checkedIn = new Set(transport.checkpointRecords.map((r) => r.checkpointId));
    const items = transport.shipments.map((s) => ({
      shipmentId: s.shipmentId,
      masterCode: s.master.masterCode,
      customerName: s.master.customer.companyName || s.master.customer.name,
      destination: s.master.destination,
      penerimaName: s.master.penerimaName ?? null,
      dropCheckpointId: s.dropCheckpointId,
      effectiveDropCheckpointId: effectiveDropCheckpointId(s.dropCheckpointId, finalId),
      dropStatus: s.dropStatus,
      droppedAt: s.droppedAt,
      deliveryApprovedAt: s.deliveryApprovedAt,
    }));
    const statuses = items.map((i) => i.dropStatus);

    // Capacity Round (plan §18) — remaining cargo = shipments still on the
    // vehicle (LOADED / AT_DROP_POINT). Initial = all assigned cargo. Dropped =
    // cargo already unloaded (DROPPED / DELIVERY_PENDING / DELIVERY_APPROVED).
    const allMasterIds = transport.shipments.map((s) => s.shipmentId);
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(allMasterIds);
    const allMasters = transport.shipments.map((s) => ({ id: s.shipmentId, chargeableWeightKg: null, priceAmount: null }));
    const initialLoad = transportLoadFromAggregates(allMasters, volumeByMaster, actualKgByMaster, packagesByMaster);
    const remainingMasterIds = transport.shipments
      .filter((s) => s.dropStatus === "LOADED" || s.dropStatus === "AT_DROP_POINT")
      .map((s) => s.shipmentId);
    const remainingMasters = remainingMasterIds.map((mid) => ({ id: mid, chargeableWeightKg: null, priceAmount: null }));
    const remainingLoad = transportLoadFromAggregates(remainingMasters, volumeByMaster, actualKgByMaster, packagesByMaster);
    const warningThreshold = await getCapacityWarningThreshold();
    const remainingCapacity = calculateTransportCapacityStatus(
      { maxWeightKg: transport.vehicle.maxWeightKg, maxVolumeM3: transport.vehicle.maxVolumeM3, maxKoli: transport.vehicle.maxKoli },
      remainingLoad,
      warningThreshold,
    );

    return ok({
      transportMode: normalizeTransportMode(transport.transportMode),
      transportStatus: transport.status,
      deliveryApprovedAt: transport.deliveryApprovedAt,
      checkpoints: checkpoints.map((c) => ({ id: c.id, name: c.name, sequence: c.sequence, checkedIn: checkedIn.has(c.id), isFinal: c.id === finalId })),
      shipments: items,
      groups: groupByDropCheckpoint(items, checkpoints).map((g) => ({ checkpointId: g.checkpointId, shipmentIds: g.shipments.map((s) => s.shipmentId) })),
      progress: dropProgress(statuses),
      vehicleEmpty: isVehicleEmpty(statuses),
      // Capacity Round (plan §18) — remaining cargo after drops.
      loadSummary: {
        initialLoad,
        remainingLoad,
        droppedLoad: {
          totalActualWeightKg: Math.round((initialLoad.totalActualWeightKg - remainingLoad.totalActualWeightKg) * 100) / 100,
          totalVolumeM3: Math.round((initialLoad.totalVolumeM3 - remainingLoad.totalVolumeM3) * 1_000_000) / 1_000_000,
          totalKoli: initialLoad.totalKoli - remainingLoad.totalKoli,
        },
        remainingCapacity,
      },
    });
  });
}
