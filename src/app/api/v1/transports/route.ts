import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num, ci } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "transport.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));

    const transports = await db.transport.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { transportCode: ci(search) },
                { route: { name: ci(search) } },
                { vehicle: { vehicleNumber: ci(search) } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: true,
        shipments: {
          include: {
            master: {
              include: {
                customer: { select: { name: true } },
                details: { select: { quantity: true, actualWeightKg: true } },
              },
            },
          },
        },
        checkpointRecords: { select: { checkpointId: true, withinRadius: true, recordedAt: true } },
      },
    });
    const employees = await db.employee.findMany({ where: { isActive: true } });
    const employeeName = (id: number | null) => (id == null ? null : employees.find((e) => e.id === id)?.name ?? null);

    return ok(
      transports.map((t) => {
        const passedIds = new Set(t.checkpointRecords.filter((r) => r.withinRadius).map((r) => r.checkpointId));
        const totalCheckpoints = t.route?.checkpoints.length ?? 0;
        const pieces = t.shipments.reduce((sum, s) => sum + s.master.details.reduce((a, d) => a + d.quantity, 0), 0);
        const actualKg = t.shipments.reduce(
          (sum, s) => sum + s.master.details.reduce((a, d) => a + d.actualWeightKg * d.quantity, 0),
          0,
        );
        const chargeableKg = t.shipments.reduce((sum, s) => sum + (s.master.chargeableWeightKg ?? 0), 0);
        const lastRecordAt = t.checkpointRecords.reduce<string | null>(
          (latest, r) => (!latest || r.recordedAt.toISOString() > latest ? r.recordedAt.toISOString() : latest),
          null,
        );
        return {
          id: t.id,
          transportCode: t.transportCode,
          status: t.status,
          routeId: t.routeId,
          routeName: t.route?.name ?? null,
          routeCheckpoints: t.route?.checkpoints ?? [],
          vehicleId: t.vehicleId,
          vehicleNumber: t.vehicle.vehicleNumber,
          vehicleName: t.vehicle.name,
          vehicleMaxWeightKg: t.vehicle.maxWeightKg,
          driverName: employeeName(t.driverId),
          kenekName: employeeName(t.kenekId),
          departedAt: t.departedAt,
          arrivedAt: t.arrivedAt,
          createdAt: t.createdAt,
          shipments: t.shipments.map((s) => ({
            id: s.master.id,
            masterCode: s.master.masterCode,
            status: s.master.status,
            customerName: s.master.customer?.name ?? null,
            destination: s.master.destination,
            chargeableWeightKg: s.master.chargeableWeightKg,
          })),
          summary: {
            shipmentCount: t.shipments.length,
            totalPieces: pieces,
            totalActualWeightKg: Math.round(actualKg * 10) / 10,
            totalChargeableWeightKg: Math.round(chargeableKg * 10) / 10,
          },
          progress: {
            totalCheckpoints,
            passedCheckpoints: t.route?.checkpoints.filter((c) => passedIds.has(c.id)).length ?? 0,
            checkpointRecordsCount: t.checkpointRecords.length,
            lastRecordAt,
          },
        };
      }),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "transport.create");
    const body = await req.json().catch(() => ({}));
    const routeId = num(body.routeId);
    const vehicleId = num(body.vehicleId);
    if (!routeId) return fail(422, "Rute wajib dipilih.", { routeId: ["Rute wajib dipilih."] });
    if (!vehicleId) return fail(422, "Kendaraan wajib dipilih.", { vehicleId: ["Kendaraan wajib dipilih."] });

    const route = await db.route.findUnique({ where: { id: routeId }, include: { checkpoints: true } });
    if (!route) return fail(422, "Rute tidak ditemukan.", { routeId: ["Rute tidak ditemukan."] });
    if (route.checkpoints.length < 3) {
      return fail(422, `Rute harus memiliki minimal 3 checkpoint (saat ini: ${route.checkpoints.length}).`);
    }
    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return fail(422, "Kendaraan tidak ditemukan.", { vehicleId: ["Kendaraan tidak ditemukan."] });
    if (vehicle.status !== "ACTIVE") return fail(422, `Kendaraan ${vehicle.vehicleNumber} tidak aktif (${vehicle.status}).`);

    const driverId = num(body.driverId);
    const kenekId = num(body.kenekId);
    const shipmentIds = Array.isArray(body.shipmentIds) ? body.shipmentIds.map(Number).filter(Boolean) : [];

    const shipments = await db.masterShipment.findMany({ where: { id: { in: shipmentIds } } });
    for (const s of shipments) {
      if (s.status !== "RECEIVED_AT_GUDANG") {
        return fail(422, `Shipment ${s.masterCode} harus berstatus RECEIVED_AT_GUDANG (saat ini: ${s.status}).`);
      }
    }

    const transportCode = await nextCode("transport", "TRP-2026-", "transportCode");
    const transport = await db.transport.create({
      data: {
        transportCode,
        routeId,
        vehicleId,
        driverId: driverId ?? null,
        kenekId: kenekId ?? null,
        status: "PLANNED",
      },
    });
    if (shipments.length > 0) {
      await db.transportShipment.createMany({
        data: shipments.map((s) => ({ transportId: transport.id, shipmentId: s.id })),
      });
      await db.masterShipment.updateMany({ where: { id: { in: shipments.map((s) => s.id) } }, data: { status: "IN_TRANSPORT" } });
    }

    for (const s of shipments) {
      await db.trackingEvent.create({
        data: { masterId: s.id, event: "LOADED_TO_TRANSPORT", description: `Dimuat ke transport ${transport.transportCode} (rute ${route.name})`, actorId: user.id },
      });
    }
    await audit({ action: "created", entityType: "transport", entityId: transport.id, entityLabel: transport.transportCode, actor: user, after: { route: route.name, vehicle: vehicle.vehicleNumber, shipments: shipments.length } });
    return ok(transport);
  });
}
