import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";
import { detailAggregates } from "@/lib/transport-totals";

/**
 * Driver / Kenek operational dashboard (Revision Parts T, U, W).
 * GET /api/v1/dashboard/driver?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * - ONLY transports assigned to this user as driver OR kenek (server-side)
 * - current transport (DEPARTED): vehicle, crew, route, current checkpoint
 *   (latest check-in) + next pending checkpoint
 * - upcoming (PLANNED, next) & future (PLANNED, later) transports from the
 *   Transport Planning system
 * - completed count + history summary within the selected period
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "transport.view");
    const params = req.nextUrl.searchParams;

    const todayStr = new Date().toISOString().slice(0, 10);
    const fromStr = str(params.get("from")) ?? todayStr;
    let toStr = str(params.get("to")) ?? fromStr;
    if (toStr < fromStr) toStr = fromStr;
    const from = new Date(`${fromStr}T00:00:00.000`);
    const to = new Date(`${toStr}T23:59:59.999`);

    if (user.employeeId == null) {
      return ok({
        period: { from: fromStr, to: toStr },
        current: null,
        vehicle: null,
        nextCheckpoint: null,
        upcoming: [],
        future: [],
        completedCount: 0,
        history: [],
        note: "Akun tidak terhubung ke data karyawan — hubungi admin.",
      });
    }
    const me = user.employeeId;

    const transports = await db.transport.findMany({
      where: { OR: [{ driverId: me }, { kenekId: me }] },
      orderBy: { createdAt: "desc" },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        vehicle: true,
        driver: { select: { name: true } },
        kenek: { select: { name: true } },
        shipments: { include: { master: { select: { id: true, chargeableWeightKg: true, priceAmount: true } } } },
        checkpointRecords: { orderBy: { recordedAt: "desc" }, include: { checkpoint: true, recordedBy: { select: { name: true } } } },
      },
    });

    // aggregates for all transports at once (database groupBy)
    const masterIds = transports.flatMap((t) => t.shipments.map((s) => s.shipmentId));
    const { volumeByMaster, actualKgByMaster, packagesByMaster } = await detailAggregates(masterIds);

    const base = (t: (typeof transports)[number]) => {
      let weight = 0;
      let volume = 0;
      let price: number | null = null;
      let priced = 0;
      for (const s of t.shipments) {
        weight += s.master.chargeableWeightKg ?? actualKgByMaster.get(s.shipmentId) ?? 0;
        volume += volumeByMaster.get(s.shipmentId) ?? 0;
        if (s.master.priceAmount != null) {
          price = (price ?? 0) + s.master.priceAmount;
          priced += 1;
        }
      }
      const lastRecord = t.checkpointRecords[0] ?? null;
      const checkedIds = new Set(t.checkpointRecords.map((r) => r.checkpointId));
      const nextPending = t.route?.checkpoints.find((c) => !checkedIds.has(c.id)) ?? null;
      return {
        id: t.id,
        transportCode: t.transportCode,
        status: t.status,
        routeName: t.route?.name ?? null,
        origin: t.origin ?? t.route?.origin ?? null,
        destination: t.destination ?? t.route?.destination ?? null,
        plannedDepartureAt: t.plannedDepartureAt,
        plannedArrivalAt: t.plannedArrivalAt,
        departedAt: t.departedAt,
        arrivedAt: t.arrivedAt,
        vehicleNumber: t.vehicle.vehicleNumber,
        vehicleName: t.vehicle.name,
        maxWeightKg: t.vehicle.maxWeightKg,
        maxVolumeM3: t.vehicle.maxVolumeM3,
        driverName: t.driver?.name ?? null,
        kenekName: t.kenek?.name ?? null,
        shipmentCount: t.shipments.length,
        packageCount: t.shipments.reduce((sum, s) => sum + (packagesByMaster.get(s.shipmentId) ?? 0), 0),
        totalWeightKg: Math.round(weight * 100) / 100,
        totalVolumeM3: Math.round(volume * 1_000_000) / 1_000_000,
        totalPrice: priced > 0 ? price : null,
        checkpointsTotal: t.route?.checkpoints.length ?? 0,
        checkpointsCheckedIn: checkedIds.size,
        currentLatitude: t.currentLatitude,
        currentLongitude: t.currentLongitude,
        lastLocationAt: t.lastLocationAt,
        lastCheckpointName: lastRecord?.checkpoint.name ?? null,
        lastCheckinAt: lastRecord?.recordedAt ?? null,
        lastCheckinBy: lastRecord?.recordedBy?.name ?? null,
        nextCheckpoint: nextPending
          ? {
              id: nextPending.id,
              name: nextPending.name,
              sequence: nextPending.sequence,
              latitude: nextPending.latitude,
              longitude: nextPending.longitude,
              radiusMeters: nextPending.radiusMeters,
            }
          : null,
      };
    };

    const currentRaw = transports.find((t) => t.status === "DEPARTED") ?? null;
    const current = currentRaw ? base(currentRaw) : null;

    // upcoming/future planned transports, ordered by planned departure
    const planned = transports
      .filter((t) => t.status === "PLANNED")
      .sort((a, b) => {
        const at = a.plannedDepartureAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bt = b.plannedDepartureAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return at - bt;
      })
      .map(base);
    const upcoming = planned.slice(0, 1);
    const future = planned.slice(1, 6);

    const completedRaw = transports.filter(
      (t) => t.status === "ARRIVED" && t.arrivedAt != null && t.arrivedAt >= from && t.arrivedAt <= to,
    );
    const history = completedRaw.slice(0, 15).map(base);

    return ok({
      period: { from: fromStr, to: toStr },
      current,
      upcoming,
      future,
      completedCount: completedRaw.length,
      history,
      totalTransportsAllTime: transports.length,
    });
  });
}
