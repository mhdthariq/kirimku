import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { cityIndex, inScope, scopeForUser, shipmentGudangIds } from "@/lib/gudang-scope";
import { computeTotals } from "@/lib/shipment-totals";

/**
 * Gudang operations workspace:
 * - arrivals: shipments with status PICKED_UP that a kurir is bringing back to
 *   the gudang — Admin Gudang must scan every package before confirming arrival
 * - walkIns: shipments a customer can hand over directly at the gudang
 *   (Admin Gudang confirms "Arrive at Gudang" without scanning)
 * - warehouses: per-gudang contents — what packages are currently held at each
 *   gudang. Gudang data separation: every non-owner user only sees their own
 *   gudang (employee.warehouseId); only the owner sees every gudang.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    const scope = await scopeForUser(user);

    const warehouses = await db.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, city: true, customerSupportContact: true },
    });
    const cityIdx = await cityIndex();

    const inScopeNow = (s: { status: string; originWarehouseId: number | null; destinationWarehouseId: number | null; arrivedWarehouseId: number | null; origin: string; destination: string }) =>
      inScope(shipmentGudangIds(s, cityIdx), scope);

    // --- Arrival queue: PICKED_UP shipments brought back by kurir -----------
    const pendingArrivals = await db.masterShipment.findMany({
      where: { status: "PICKED_UP" },
      orderBy: { updatedAt: "asc" },
      include: {
        customer: { select: { id: true, name: true, type: true, phone: true } },
        details: { select: { id: true, actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true } },
        pickups: { orderBy: { completedAt: "desc" }, take: 1, select: { id: true, pickupCode: true, kurirId: true, completedAt: true } },
      },
    });
    const scopedArrivals = pendingArrivals.filter((s) => inScopeNow(s));
    const arrivalIds = scopedArrivals.map((s) => s.id);
    const arrivalScanRows = arrivalIds.length
      ? await db.handoverScan.findMany({
          where: { context: "gudang_arrival", masterId: { in: arrivalIds }, result: { in: ["ok", "duplicate"] } },
          select: { detailId: true, method: true },
        })
      : [];
    const detailMaster = new Map<number, number>();
    for (const s of scopedArrivals) for (const d of s.details) detailMaster.set(d.id, s.id);
    const scannedPerMaster = new Map<number, number>();
    const scannedByMethod = new Map<number, { SCANNED: number; TYPED: number }>();
    for (const scan of arrivalScanRows) {
      if (scan.detailId == null) continue;
      const mid = detailMaster.get(scan.detailId);
      if (mid == null) continue;
      scannedPerMaster.set(mid, (scannedPerMaster.get(mid) ?? 0) + 1);
      const m = scannedByMethod.get(mid) ?? { SCANNED: 0, TYPED: 0 };
      m[scan.method === "SCANNED" ? "SCANNED" : "TYPED"] += 1;
      scannedByMethod.set(mid, m);
    }
    const paymentRows = arrivalIds.length
      ? await db.payment.findMany({
          where: { masterId: { in: arrivalIds }, status: { in: ["RECORDED", "VERIFIED"] } },
          select: { masterId: true, amount: true },
        })
      : [];
    const paidPerMaster = new Map<number, number>();
    for (const p of paymentRows) paidPerMaster.set(p.masterId, (paidPerMaster.get(p.masterId) ?? 0) + p.amount);
    const employees = await db.employee.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const employeeName = (id: number | null) => (id == null ? null : employees.find((e) => e.id === id)?.name ?? null);

    const arrivals = scopedArrivals.map((s) => {
      const totals = computeTotals(s.details);
      const paid = paidPerMaster.get(s.id) ?? 0;
      const lastPickup = s.pickups[0] ?? null;
      // Revise.md §6 — the customer owes the discounted FINAL price.
      const finalPrice = s.finalPriceAmount ?? (s.priceAmount != null ? s.priceAmount - (s.discountAmount ?? 0) : null);
      return {
        id: s.id,
        masterCode: s.masterCode,
        customerName: s.customer.name,
        customerPhone: s.customer.phone,
        origin: s.origin,
        destination: s.destination,
        originWarehouseId: s.originWarehouseId,
        destinationWarehouseId: s.destinationWarehouseId,
        priceAmount: s.priceAmount,
        paidAmount: paid,
        remainingAmount: finalPrice != null ? Math.max(0, finalPrice - paid) : null,
        dpOk: finalPrice == null || paid >= finalPrice / 2 - 0.01,
        penerimaName: s.penerimaName,
        detailsCount: totals.totalPackages,
        totalWeightKg: totals.totalActualKg,
        totalVolumeM3: totals.totalVolumeM3,
        scannedCount: scannedPerMaster.get(s.id) ?? 0,
        scannedByMethod: scannedByMethod.get(s.id) ?? { SCANNED: 0, TYPED: 0 },
        pickupCode: lastPickup?.pickupCode ?? null,
        kurirName: employeeName(lastPickup?.kurirId ?? null),
        updatedAt: s.updatedAt,
      };
    });

    // --- Walk-in candidates: customer brings the package to the gudang -------
    const walkInShipments = await db.masterShipment.findMany({
      where: { status: { in: ["CREATED", "READY_FOR_PICKUP"] } },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { name: true } },
        details: { select: { actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true } },
      },
    });
    const walkIns = walkInShipments
      .filter((s) => inScopeNow(s))
      .map((s) => {
        const finalPrice = s.finalPriceAmount ?? (s.priceAmount != null ? s.priceAmount - (s.discountAmount ?? 0) : null);
        const totals = computeTotals(s.details);
        return {
          id: s.id,
          masterCode: s.masterCode,
          customerName: s.customer.name,
          origin: s.origin,
          destination: s.destination,
          originWarehouseId: s.originWarehouseId,
          destinationWarehouseId: s.destinationWarehouseId,
          status: s.status,
          priceAmount: s.priceAmount,
          finalPriceAmount: finalPrice,
          penerimaName: s.penerimaName,
          detailsCount: totals.totalPackages,
          totalWeightKg: totals.totalActualKg,
          totalVolumeM3: totals.totalVolumeM3,
        };
      });

    // --- Per-gudang contents: what is physically held at each gudang ---------
    const heldShipments = await db.masterShipment.findMany({
      where: { status: { in: ["RECEIVED_AT_GUDANG", "ARRIVED_AT_GUDANG"] } },
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { name: true } },
        details: { select: { actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true } },
      },
    });
    const heldPaymentRows = heldShipments.length
      ? await db.payment.findMany({
          where: { masterId: { in: heldShipments.map((s) => s.id) }, status: { in: ["RECORDED", "VERIFIED"] } },
          select: { masterId: true, amount: true },
        })
      : [];
    const heldPaid = new Map<number, number>();
    for (const p of heldPaymentRows) heldPaid.set(p.masterId, (heldPaid.get(p.masterId) ?? 0) + p.amount);

    const sameCity = (a: string, b: string | null | undefined) => !!b && a.toLowerCase() === b.toLowerCase();
    const warehouseContents = warehouses
      .filter((w) => (scope.unscoped ? true : scope.warehouseId != null && w.id === scope.warehouseId))
      .map((w) => {
        const shipments = heldShipments.filter((s) => {
          if (s.status === "RECEIVED_AT_GUDANG") {
            // held at origin gudang: confirmed arrival warehouse, or origin match
            if (s.arrivedWarehouseId != null) return s.arrivedWarehouseId === w.id;
            if (s.originWarehouseId != null) return s.originWarehouseId === w.id;
            return sameCity(s.origin, w.city);
          }
          // ARRIVED_AT_GUDANG: held at destination gudang
          if (s.arrivedWarehouseId != null) return s.arrivedWarehouseId === w.id;
          if (s.destinationWarehouseId != null) return s.destinationWarehouseId === w.id;
          return sameCity(s.destination, w.city);
        });
        const rows = shipments.map((s) => {
          const totals = computeTotals(s.details);
          const paid = heldPaid.get(s.id) ?? 0;
          const finalPrice = s.finalPriceAmount ?? (s.priceAmount != null ? s.priceAmount - (s.discountAmount ?? 0) : null);
          return {
            id: s.id,
            masterCode: s.masterCode,
            customerName: s.customer.name,
            status: s.status,
            stage: s.status === "RECEIVED_AT_GUDANG" ? "origin" : "destination",
            packages: totals.totalPackages,
            weightKg: totals.totalActualKg,
            volumeM3: totals.totalVolumeM3,
            priceAmount: s.priceAmount,
            remainingAmount: finalPrice != null ? Math.max(0, finalPrice - paid) : null,
            updatedAt: s.updatedAt,
          };
        });
        return {
          id: w.id,
          code: w.code,
          name: w.name,
          city: w.city,
          customerSupportContact: w.customerSupportContact,
          heldShipments: rows.length,
          heldPackages: rows.reduce((sum, r) => sum + r.packages, 0),
          heldWeightKg: Math.round(rows.reduce((sum, r) => sum + r.weightKg, 0) * 100) / 100,
          unpaidCount: rows.filter((r) => (r.remainingAmount ?? 0) > 0).length,
          shipments: rows,
        };
      });

    const scopeWarehouse = !scope.unscoped && scope.warehouseId != null ? warehouses.find((w) => w.id === scope.warehouseId) ?? null : null;
    return ok({
      scope: scopeWarehouse
        ? { warehouseId: scopeWarehouse.id, warehouseName: scopeWarehouse.name, scoped: true }
        : { warehouseId: null, warehouseName: null, scoped: false },
      arrivals,
      walkIns,
      warehouses: warehouseContents,
    });
  });
}
