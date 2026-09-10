import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, str, dateOrNull } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";
import { aggregateTransport, detailAggregates, isExecutorOnly } from "@/lib/transport-totals";

type Params = { params: Promise<{ id: string }> };

/**
 * Transport detail (Revision Part K) with:
 * - transport info (origin/destination, route, schedule, vehicle, crew)
 * - checkpoint check-in records (photo evidence, location, who, when)
 * - assigned shipments with per-shipment weight/volume/price
 * - aggregate totals (Revision Part L)
 *
 * Revision Part Y — authorization: an executor-only user (driver / kenek
 * without planning permissions) may only open a transport assigned to them.
 */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: true,
        driver: true,
        kenek: true,
        shipments: { include: { master: { include: { customer: { select: { name: true } } } } } },
        checkpointRecords: {
          orderBy: { recordedAt: "desc" },
          include: { checkpoint: true, recordedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");

    // Server-side assignment check (Part Y) — never rely on frontend hiding.
    if (isExecutorOnly(user)) {
      const mine =
        user.employeeId != null &&
        (transport.driverId === user.employeeId || transport.kenekId === user.employeeId);
      if (!mine) {
        return fail(403, "Transport ini tidak ditugaskan kepada Anda.");
      }
    }

    // Aggregates (Part L) — database groupBy, not frontend loops.
    const masterIds = transport.shipments.map((s) => s.shipmentId);
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(masterIds);
    const masters = transport.shipments.map((s) => s.master);
    const agg = aggregateTransport(masters, volumeByMaster, actualKgByMaster);

    return ok({
      id: transport.id,
      transportCode: transport.transportCode,
      status: transport.status,
      routeId: transport.routeId,
      routeName: transport.route?.name ?? null,
      routeOrigin: transport.route?.origin ?? null,
      routeDestination: transport.route?.destination ?? null,
      checkpoints: transport.route?.checkpoints ?? [],
      origin: transport.origin ?? transport.route?.origin ?? null,
      destination: transport.destination ?? transport.route?.destination ?? null,
      plannedDepartureAt: transport.plannedDepartureAt,
      plannedArrivalAt: transport.plannedArrivalAt,
      departedAt: transport.departedAt,
      arrivedAt: transport.arrivedAt,
      createdAt: transport.createdAt,
      updatedAt: transport.updatedAt,
      vehicle: {
        id: transport.vehicle.id,
        vehicleNumber: transport.vehicle.vehicleNumber,
        name: transport.vehicle.name,
        status: transport.vehicle.status,
        maxWeightKg: transport.vehicle.maxWeightKg,
        maxVolumeM3: transport.vehicle.maxVolumeM3,
      },
      driver: transport.driver ? { id: transport.driver.id, name: transport.driver.name } : null,
      kenek: transport.kenek ? { id: transport.kenek.id, name: transport.kenek.name } : null,
      // last known position (Part K) — updated by checkpoint check-ins
      currentLatitude: transport.currentLatitude,
      currentLongitude: transport.currentLongitude,
      lastLocationAt: transport.lastLocationAt,
      // check-in records with photo evidence (Parts K/O)
      checkpointRecords: transport.checkpointRecords.map((r) => ({
        id: r.id,
        checkpointId: r.checkpointId,
        checkpointName: r.checkpoint.name,
        checkpointSequence: r.checkpoint.sequence,
        latitude: r.latitude,
        longitude: r.longitude,
        withinRadius: r.withinRadius,
        distanceMeters: r.distanceMeters,
        photoUrl: r.photoUrl,
        recordedBy: r.recordedBy ? { id: r.recordedBy.id, name: r.recordedBy.name } : null,
        recordedAt: r.recordedAt,
      })),
      // shipments (Part K) with per-shipment totals
      shipments: transport.shipments.map((s) => ({
        id: s.master.id,
        masterCode: s.master.masterCode,
        resi: s.master.resi,
        status: s.master.status,
        origin: s.master.origin,
        destination: s.master.destination,
        customerName: s.master.customer?.name ?? null,
        penerimaName: s.master.penerimaName,
        packages: packagesByMaster.get(s.shipmentId) ?? 0,
        weightKg: Math.round((s.master.chargeableWeightKg ?? actualKgByMaster.get(s.shipmentId) ?? 0) * 100) / 100,
        volumeM3: Math.round((volumeByMaster.get(s.shipmentId) ?? 0) * 1_000_000) / 1_000_000,
        priceAmount: s.master.priceAmount,
        details: [],
      })),
      // aggregate totals (Part L)
      shipmentCount: agg.shipmentCount,
      totalWeightKg: agg.totalWeightKg,
      totalVolumeM3: agg.totalVolumeM3,
      totalPrice: agg.totalPrice,
    });
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.create");
    const { id } = await params;
    const existing = await db.transport.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Transport tidak ditemukan.");
    if (["DEPARTED", "ARRIVED"].includes(existing.status)) {
      return fail(422, `Transport dengan status ${existing.status} tidak bisa diubah.`);
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.routeId !== undefined) data.routeId = num(body.routeId);
    if (body.vehicleId !== undefined) data.vehicleId = num(body.vehicleId);
    if (body.driverId !== undefined) data.driverId = num(body.driverId);
    if (body.kenekId !== undefined) data.kenekId = num(body.kenekId);
    if (body.origin !== undefined) data.origin = str(body.origin);
    if (body.destination !== undefined) data.destination = str(body.destination);
    if (body.plannedDepartureAt !== undefined) data.plannedDepartureAt = dateOrNull(body.plannedDepartureAt);
    if (body.plannedArrivalAt !== undefined) data.plannedArrivalAt = dateOrNull(body.plannedArrivalAt);

    const plannedDepartureAt = (data.plannedDepartureAt as Date | null | undefined) ?? existing.plannedDepartureAt;
    const plannedArrivalAt = (data.plannedArrivalAt as Date | null | undefined) ?? existing.plannedArrivalAt;
    if (plannedDepartureAt && plannedArrivalAt && plannedArrivalAt < plannedDepartureAt) {
      return fail(422, "Rencana tiba tidak boleh lebih awal dari rencana berangkat.", {
        plannedArrivalAt: ["Rencana tiba harus setelah rencana berangkat."],
      });
    }

    const transport = await db.transport.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "transport", entityId: transport.id, entityLabel: transport.transportCode, actor: user, before: diffFields(existing, transport as unknown as Record<string, unknown>) });
    return ok(transport);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.create");
    const { id } = await params;
    const existing = await db.transport.findUnique({ where: { id: Number(id) }, include: { shipments: { include: { master: true } } } });
    if (!existing) return fail(404, "Transport tidak ditemukan.");
    if (existing.status !== "PLANNED") return fail(422, "Hanya transport PLANNED yang bisa dihapus.");

    await db.$transaction(async (tx) => {
      for (const s of existing.shipments) {
        if (s.master.status === "IN_TRANSPORT") {
          await tx.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "RECEIVED_AT_GUDANG" } });
        }
      }
      await tx.transport.delete({ where: { id: existing.id } });
    });
    await audit({ action: "deleted", entityType: "transport", entityId: existing.id, entityLabel: existing.transportCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
