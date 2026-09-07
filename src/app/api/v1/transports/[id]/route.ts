import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: true,
        shipments: { include: { master: { include: { customer: true, details: true } } } },
        checkpointRecords: { orderBy: { recordedAt: "desc" }, include: { checkpoint: true, recordedBy: true } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");

    const employees = await db.employee.findMany({ where: { isActive: true } });
    const employeeName = (empId: number | null) => (empId == null ? null : employees.find((e) => e.id === empId)?.name ?? null);

    const checkpoints = transport.route?.checkpoints ?? [];
    const records = [...transport.checkpointRecords].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
    const passedIds = new Set(records.filter((r) => r.withinRadius).map((r) => r.checkpointId));
    const passed = checkpoints.filter((c) => passedIds.has(c.id));
    const maxPassedSeq = passed.length > 0 ? Math.max(...passed.map((c) => c.sequence)) : 0;
    const lastRecord = records.length > 0 ? records[records.length - 1] : null;

    // Where the vehicle currently is.
    let currentPosition: { latitude: number; longitude: number; label: string; kind: string; recordedAt: string | null };
    const origin = checkpoints[0] ?? null;
    const destination = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
    if (transport.status === "ARRIVED" && destination) {
      currentPosition = {
        latitude: destination.latitude, longitude: destination.longitude,
        label: `Tiba di tujuan — ${destination.name}`,
        kind: "ARRIVED", recordedAt: transport.arrivedAt?.toISOString() ?? null,
      };
    } else if (transport.status === "DEPARTED" && lastRecord) {
      const nextCp = checkpoints.find((c) => c.sequence > maxPassedSeq) ?? null;
      currentPosition = {
        latitude: lastRecord.latitude, longitude: lastRecord.longitude,
        label: lastRecord.withinRadius
          ? `Melewati ${lastRecord.checkpoint.name}${nextCp ? ` — menuju ${nextCp.name}` : ""}`
          : `Posisi GPS terakhir dekat ${lastRecord.checkpoint.name}`,
        kind: "ROUTE", recordedAt: lastRecord.recordedAt.toISOString(),
      };
    } else if (transport.status === "DEPARTED" && origin) {
      currentPosition = {
        latitude: origin.latitude, longitude: origin.longitude,
        label: "Sudah berangkat — belum ada catatan posisi (titik awal rute)",
        kind: "ROUTE", recordedAt: transport.departedAt?.toISOString() ?? null,
      };
    } else {
      currentPosition = {
        latitude: origin?.latitude ?? -6.2, longitude: origin?.longitude ?? 106.82,
        label: origin ? `Belum berangkat — titik awal ${origin.name}` : "Belum berangkat",
        kind: "PRE_DEPARTURE", recordedAt: null,
      };
    }

    // Per-shipment payload + load summary.
    const shipments = transport.shipments.map((s) => {
      const pieces = s.master.details.reduce((sum, d) => sum + d.quantity, 0);
      const actualKg = s.master.details.reduce((sum, d) => sum + d.actualWeightKg * d.quantity, 0);
      const volumetricKg = s.master.details.reduce((sum, d) => sum + (d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0) * d.quantity, 0) / 6000;
      return {
        id: s.master.id,
        masterCode: s.master.masterCode,
        status: s.master.status,
        customerName: s.master.customer?.name ?? null,
        origin: s.master.origin,
        destination: s.master.destination,
        pieces,
        actualWeightKg: Math.round(actualKg * 10) / 10,
        volumetricWeightKg: Math.round(volumetricKg * 10) / 10,
        chargeableWeightKg: s.master.chargeableWeightKg,
        ratePerKg: s.master.ratePerKg,
        priceAmount: s.master.priceAmount,
        detailsCount: s.master.details.length,
      };
    });
    const summary = {
      shipmentCount: shipments.length,
      totalPieces: shipments.reduce((sum, s) => sum + s.pieces, 0),
      totalActualWeightKg: Math.round(shipments.reduce((sum, s) => sum + s.actualWeightKg, 0) * 10) / 10,
      totalVolumetricWeightKg: Math.round(shipments.reduce((sum, s) => sum + s.volumetricWeightKg, 0) * 10) / 10,
      totalChargeableWeightKg: Math.round(shipments.reduce((sum, s) => sum + (s.chargeableWeightKg ?? 0), 0) * 10) / 10,
      totalValueRp: shipments.reduce((sum, s) => sum + (s.priceAmount ?? 0), 0),
      totalVolumeM3: Math.round(transport.shipments.reduce((sum, s) => sum + s.master.details.reduce((v, d) => v + (d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0) * d.quantity, 0), 0) / 1_000_000 * 1000) / 1000,
    };

    return ok({
      id: transport.id,
      transportCode: transport.transportCode,
      status: transport.status,
      createdAt: transport.createdAt,
      departedAt: transport.departedAt,
      arrivedAt: transport.arrivedAt,
      route: transport.route
        ? { id: transport.route.id, name: transport.route.name, origin: transport.route.origin, destination: transport.route.destination }
        : null,
      checkpoints: checkpoints.map((c) => ({
        id: c.id, name: c.name, sequence: c.sequence,
        latitude: c.latitude, longitude: c.longitude, radiusMeters: c.radiusMeters,
        passed: passedIds.has(c.id),
        lastRecordAt: records.filter((r) => r.checkpointId === c.id).at(-1)?.recordedAt.toISOString() ?? null,
      })),
      vehicle: {
        id: transport.vehicle.id, vehicleNumber: transport.vehicle.vehicleNumber, name: transport.vehicle.name,
        maxWeightKg: transport.vehicle.maxWeightKg, maxVolumeM3: transport.vehicle.maxVolumeM3,
      },
      driverName: employeeName(transport.driverId),
      kenekName: employeeName(transport.kenekId),
      shipments,
      summary,
      progress: {
        totalCheckpoints: checkpoints.length,
        passedCheckpoints: passed.length,
        recordsCount: records.length,
        lastRecord: lastRecord
          ? {
              checkpointId: lastRecord.checkpointId, checkpointName: lastRecord.checkpoint.name,
              sequence: lastRecord.checkpoint.sequence, latitude: lastRecord.latitude, longitude: lastRecord.longitude,
              withinRadius: lastRecord.withinRadius,
              recordedAt: lastRecord.recordedAt.toISOString(),
              recordedByName: lastRecord.recordedBy?.name ?? null,
            }
          : null,
        nextCheckpoint: transport.status === "DEPARTED"
          ? checkpoints.find((c) => c.sequence > maxPassedSeq) ?? null
          : null,
        currentPosition,
      },
      checkpointRecords: records
        .slice()
        .reverse()
        .map((r) => ({
          id: r.id, checkpointId: r.checkpointId, checkpointName: r.checkpoint.name,
          sequence: r.checkpoint.sequence, latitude: r.latitude, longitude: r.longitude,
          withinRadius: r.withinRadius, recordedAt: r.recordedAt.toISOString(),
          recordedByName: r.recordedBy?.name ?? null,
        })),
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

    for (const s of existing.shipments) {
      if (s.master.status === "IN_TRANSPORT") {
        await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "RECEIVED_AT_GUDANG" } });
      }
    }
    await db.transport.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "transport", entityId: existing.id, entityLabel: existing.transportCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
