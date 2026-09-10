import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str, num } from "@/lib/api-helpers";

/**
 * Kurir operational dashboard (Revision Part R).
 * GET /api/v1/dashboard/kurir?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * - only the kurir's OWN tasks (kurirId = employee id) — enforced server-side
 * - live counters: assigned pickups / picked up / completed, deliveries
 * - period lists: pickup & delivery activity within [from..to] (inclusive,
 *   whole days; `from` defaults to TODAY when omitted)
 * - Period membership: createdAt OR completedAt inside the window, plus any
 *   still-active task regardless of period so nothing urgent is hidden.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "pickup.view");
    const params = req.nextUrl.searchParams;

    // ---- period parsing (default: today) ----------------------------------
    const todayStr = new Date().toISOString().slice(0, 10);
    const fromStr = str(params.get("from")) ?? todayStr;
    let toStr = str(params.get("to")) ?? fromStr;
    if (toStr < fromStr) toStr = fromStr;
    const from = new Date(`${fromStr}T00:00:00.000`);
    const to = new Date(`${toStr}T23:59:59.999`);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);

    if (user.employeeId == null) {
      return ok({
        period: { from: fromStr, to: toStr, days },
        counts: { pickupsAssigned: 0, pickupsPickedUp: 0, pickupsCompleted: 0, deliveriesAssigned: 0, deliveriesDelivered: 0 },
        pickups: [],
        deliveries: [],
        note: "Akun tidak terhubung ke data karyawan — hubungi admin.",
      });
    }
    const me = user.employeeId;

    // ---- pickups (mine only) ----------------------------------------------
    const pickupRows = await db.pickup.findMany({
      where: { kurirId: me },
      orderBy: { createdAt: "desc" },
      include: {
        master: {
          select: {
            masterCode: true, status: true, origin: true, destination: true,
            customer: { select: { name: true, phone: true } },
            _count: { select: { details: true } },
          },
        },
        scans: { select: { detailId: true, result: true } },
      },
    });

    const activePickups = pickupRows.filter((p) => ["ASSIGNED", "PICKED_UP", "IN_PROGRESS"].includes(p.status));
    const inPeriodPickup = pickupRows.filter(
      (p) =>
        (p.createdAt >= from && p.createdAt <= to) ||
        (p.completedAt != null && p.completedAt >= from && p.completedAt <= to),
    );
    const pickups = [...activePickups, ...inPeriodPickup.filter((p) => !activePickups.includes(p))];

    // ---- deliveries (mine only) -------------------------------------------
    const deliveryRows = await db.delivery.findMany({
      where: { kurirId: me },
      orderBy: { createdAt: "desc" },
      include: {
        master: {
          select: {
            masterCode: true, status: true, destination: true, penerimaName: true, penerimaAddress: true, priceAmount: true,
            customer: { select: { name: true, phone: true } },
            _count: { select: { details: true } },
          },
        },
        scans: { select: { detailId: true, result: true } },
      },
    });
    const activeDeliveries = deliveryRows.filter((d) => d.status === "ASSIGNED");
    const inPeriodDelivery = deliveryRows.filter(
      (d) =>
        (d.createdAt >= from && d.createdAt <= to) ||
        (d.completedAt != null && d.completedAt >= from && d.completedAt <= to),
    );
    const deliveries = [...activeDeliveries, ...inPeriodDelivery.filter((d) => !activeDeliveries.includes(d))];

    const scannedCount = (scans: { detailId: number | null; result: string }[]) =>
      new Set(scans.filter((s) => s.detailId != null && s.result !== "unexpected").map((s) => s.detailId)).size;

    return ok({
      period: { from: fromStr, to: toStr, days },
      counts: {
        pickupsAssigned: activePickups.filter((p) => p.status === "ASSIGNED").length,
        pickupsPickedUp: activePickups.filter((p) => p.status === "PICKED_UP").length,
        pickupsCompleted: pickupRows.filter((p) => p.status === "COMPLETED" && p.completedAt != null && p.completedAt >= from && p.completedAt <= to).length,
        deliveriesAssigned: activeDeliveries.length,
        deliveriesDelivered: deliveryRows.filter((d) => d.status === "COMPLETED" && d.completedAt != null && d.completedAt >= from && d.completedAt <= to).length,
      },
      pickups: pickups.slice(0, 30).map((p) => ({
        id: p.id,
        pickupCode: p.pickupCode,
        status: p.status,
        masterCode: p.master.masterCode,
        masterStatus: p.master.status,
        origin: p.master.origin,
        destination: p.master.destination,
        customerName: p.master.customer.name,
        customerPhone: p.master.customer.phone,
        detailsCount: p.master._count.details,
        scannedCount: scannedCount(p.scans),
        createdAt: p.createdAt,
        completedAt: p.completedAt,
      })),
      deliveries: deliveries.slice(0, 30).map((d) => ({
        id: d.id,
        deliveryCode: d.deliveryCode,
        status: d.status,
        masterCode: d.master.masterCode,
        masterStatus: d.master.status,
        destination: d.master.destination,
        address: d.master.penerimaAddress,
        penerimaName: d.master.penerimaName,
        customerName: d.master.customer.name,
        customerPhone: d.master.customer.phone,
        priceAmount: d.master.priceAmount,
        detailsCount: d.master._count.details,
        scannedCount: scannedCount(d.scans),
        createdAt: d.createdAt,
        completedAt: d.completedAt,
      })),
    });
  });
}
