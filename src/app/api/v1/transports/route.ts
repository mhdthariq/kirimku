import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num, dateOrNull } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { cityIndex, inScope, scopeForUser, transportGudangIds } from "@/lib/gudang-scope";
import { aggregateTransport, detailAggregates, isExecutorOnly } from "@/lib/transport-totals";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "transport.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    // ?mine=true — explicit executor view (driver / kenek)
    const mine = params.get("mine") === "true";
    // ?history=true — driver / kenek history view: only finished transports
    const history = params.get("history") === "true";

    const executorOnly = isExecutorOnly(user);
    const forceMine = executorOnly || mine;

    const transports = await db.transport.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(history ? { status: { in: ["ARRIVED", "CANCELLED"] } } : {}),
        ...(forceMine && user.employeeId != null
          ? { OR: [{ driverId: user.employeeId }, { kenekId: user.employeeId }] }
          : forceMine
            ? { id: -1 } // logged-in executor with no employee binding → nothing
            : {}),
        ...(search
          ? {
              OR: [
                { transportCode: { contains: search } },
                { route: { name: { contains: search } } },
                { vehicle: { vehicleNumber: { contains: search } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: { include: { owner: { include: { user: { select: { name: true } } } } } },
        shipments: { include: { master: true } },
        settlement: true,
        _count: { select: { checkpointRecords: true } },
      },
    });
    const employees = await db.employee.findMany({ where: { isActive: true } });
    const employeeName = (id: number | null) => (id == null ? null : employees.find((e) => e.id === id)?.name ?? null);

    // Gudang data separation: a transport belongs to the endpoint gudangs of
    // its route (origin loads it, destination receives it); scoped users only
    // see transports touching their own gudang. Rows carry gudangIds for the
    // owner's per-gudang tabs.
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();
    const withGudang = transports.map((t) => ({
      t,
      gudangIds: transportGudangIds(t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master), cityIdx),
    }));
    const visible = withGudang.filter(({ gudangIds }) => inScope(gudangIds, scope));

    // Revision Part L/M — database aggregation for totals (weight / volume /
    // price / count) instead of pushing every package to the frontend.
    const allMasterIds = transports.flatMap((t) => t.shipments.map((s) => s.shipmentId));
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(allMasterIds);

    return ok(
      visible.map(({ t, gudangIds }) => {
        const masters = t.shipments.map((s) => s.master);
        const agg = aggregateTransport(masters, volumeByMaster, actualKgByMaster);
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
          // Revise.md §14 — vehicle owner + settlement state for the settle action
          vehicleOwnerId: t.vehicle.ownerId,
          vehicleOwnerName: t.vehicle.owner?.user.name ?? null,
          settlement: t.settlement
            ? {
                settlementCode: t.settlement.settlementCode,
                status: t.settlement.status,
                transportValue: t.settlement.transportValue,
                companyPercent: t.settlement.companyPercent,
                ownerPercent: t.settlement.ownerPercent,
                companyAmount: t.settlement.companyAmount,
                ownerAmount: t.settlement.ownerAmount,
                finalizedAt: t.settlement.finalizedAt,
              }
            : null,
          driverName: employeeName(t.driverId),
          kenekName: employeeName(t.kenekId),
          // Planning fields (Revision Part J)
          origin: t.origin ?? t.route?.origin ?? null,
          destination: t.destination ?? t.route?.destination ?? null,
          plannedDepartureAt: t.plannedDepartureAt,
          plannedArrivalAt: t.plannedArrivalAt,
          departedAt: t.departedAt,
          arrivedAt: t.arrivedAt,
          createdAt: t.createdAt,
          // Last known position (Revision Part K)
          currentLatitude: t.currentLatitude,
          currentLongitude: t.currentLongitude,
          lastLocationAt: t.lastLocationAt,
          shipments: t.shipments.map((s) => ({
            id: s.master.id,
            masterCode: s.master.masterCode,
            status: s.master.status,
            packages: packagesByMaster.get(s.shipmentId) ?? 0,
          })),
          checkpointRecordsCount: t._count.checkpointRecords,
          // Aggregates (Revision Parts L/M)
          shipmentCount: agg.shipmentCount,
          totalWeightKg: agg.totalWeightKg,
          totalVolumeM3: agg.totalVolumeM3,
          totalPrice: agg.totalPrice,
          gudangIds,
        };
      }),
    );
  });
}

/**
 * Create / PLAN a transport (Revision Part J).
 * Body: { routeId, vehicleId, driverId?, kenekId?, origin?, destination?,
 *         plannedDepartureAt?, plannedArrivalAt?, shipmentIds?[] }
 */
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
    if (driverId != null && kenekId != null && driverId === kenekId) {
      return fail(422, "Driver dan kenek tidak boleh orang yang sama.", { kenekId: ["Pilih kenek yang berbeda dari driver."] });
    }
    const shipmentIds = Array.isArray(body.shipmentIds) ? body.shipmentIds.map(Number).filter(Boolean) : [];

    const shipments = await db.masterShipment.findMany({ where: { id: { in: shipmentIds } } });
    for (const s of shipments) {
      if (s.status !== "RECEIVED_AT_GUDANG") {
        return fail(422, `Shipment ${s.masterCode} harus berstatus RECEIVED_AT_GUDANG (saat ini: ${s.status}).`);
      }
    }

    // Planning fields — endpoints default to the route's, schedule optional.
    const origin = str(body.origin) ?? route.origin ?? null;
    const destination = str(body.destination) ?? route.destination ?? null;
    const plannedDepartureAt = dateOrNull(body.plannedDepartureAt);
    const plannedArrivalAt = dateOrNull(body.plannedArrivalAt);
    if (plannedDepartureAt && plannedArrivalAt && plannedArrivalAt < plannedDepartureAt) {
      return fail(422, "Rencana tiba tidak boleh lebih awal dari rencana berangkat.", {
        plannedArrivalAt: ["Rencana tiba harus setelah rencana berangkat."],
      });
    }

    const transportCode = await nextCode("transport", "TRP-2026-", "transportCode");
    const transport = await db.$transaction(async (tx) => {
      const created = await tx.transport.create({
        data: {
          transportCode,
          routeId,
          vehicleId,
          driverId: driverId ?? null,
          kenekId: kenekId ?? null,
          origin,
          destination,
          plannedDepartureAt,
          plannedArrivalAt,
          status: "PLANNED",
        },
      });
      if (shipments.length > 0) {
        await tx.transportShipment.createMany({
          data: shipments.map((s) => ({ transportId: created.id, shipmentId: s.id })),
        });
        await tx.masterShipment.updateMany({ where: { id: { in: shipments.map((s) => s.id) } }, data: { status: "IN_TRANSPORT" } });
      }
      return created;
    });

    for (const s of shipments) {
      await db.trackingEvent.create({
        data: { masterId: s.id, event: "LOADED_TO_TRANSPORT", description: `Dimuat ke transport ${transport.transportCode} (rute ${route.name})`, actorId: user.id },
      });
    }
    await audit({
      action: "created", entityType: "transport", entityId: transport.id, entityLabel: transport.transportCode, actor: user,
      after: {
        route: route.name, vehicle: vehicle.vehicleNumber, shipments: shipments.length,
        origin, destination, plannedDepartureAt, plannedArrivalAt,
        driverId: driverId ?? null, kenekId: kenekId ?? null,
      },
    });
    return ok(transport);
  });
}
