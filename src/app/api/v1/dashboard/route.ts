import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/auth";
import { cityIndex, inScope, scopeForUser, shipmentGudangIds, pickupGudangIds, deliveryGudangIds, transportGudangIds } from "@/lib/gudang-scope";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const can = (p: string) => hasPermission(user, p);

    // Gudang data separation: operational counters & recent lists are scoped
    // to the user's gudang (only the owner sees company-wide numbers).
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();

    const [customers, shipmentRows, pickupRows, deliveryRows, transportRows, vehicles, gudang, routes, invoices, unpaidInvoices, activeTariffs] =
      await Promise.all([
        db.customer.count({ where: { isActive: true } }),
        can("shipment.view")
          ? db.masterShipment.findMany({ select: { id: true, status: true, masterCode: true, origin: true, destination: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, createdAt: true, customer: { select: { name: true } } } })
          : Promise.resolve([]),
        can("pickup.view")
          ? db.pickup.findMany({ where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, select: { id: true, master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } })
          : Promise.resolve([]),
        can("delivery.view")
          ? db.delivery.findMany({ where: { status: "ASSIGNED" }, select: { id: true, master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } })
          : Promise.resolve([]),
        can("transport.view")
          ? db.transport.findMany({ where: { status: "DEPARTED" }, select: { id: true, route: { select: { origin: true, destination: true } }, shipments: { select: { master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } } } })
          : Promise.resolve([]),
        db.vehicle.count(),
        db.warehouse.count({ where: { isActive: true } }),
        db.route.count({ where: { isActive: true } }),
        db.invoice.count(),
        db.invoice.count({ where: { status: { in: ["SENT", "PARTIALLY_SETTLED"] } } }),
        db.tariff.count({ where: { isActive: true } }),
      ]);

    const scopedShipments = shipmentRows.filter((s) => inScope(shipmentGudangIds(s, cityIdx), scope));
    const scopedPickups = pickupRows.filter((p) => inScope(pickupGudangIds(p.master, cityIdx), scope));
    const scopedDeliveries = deliveryRows.filter((d) => inScope(deliveryGudangIds(d.master, cityIdx), scope));
    const scopedTransports = transportRows.filter((t) => inScope(transportGudangIds(t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master), cityIdx), scope));

    const statusCounts: Record<string, number> = {};
    for (const s of scopedShipments) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

    const recentShipments = scopedShipments
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 6);

    const recentAudit = can("audit_log.view")
      ? await db.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { actor: true },
        })
      : [];

    const revenueAgg = await db.payment.aggregate({
      where: { status: "VERIFIED" },
      _sum: { amount: true },
    });

    return ok({
      counts: {
        customers: can("customer.view") ? customers : null,
        shipments: can("shipment.view") ? scopedShipments.length : null,
        activePickups: can("pickup.view") ? scopedPickups.length : null,
        pendingDeliveries: can("delivery.view") ? scopedDeliveries.length : null,
        inTransit: can("transport.view") ? scopedTransports.length : null,
        vehicles: can("vehicle.view") ? vehicles : null,
        gudang: can("warehouse.view") ? gudang : null,
        routes: can("checkpoint.view") ? routes : null,
        invoices: can("invoice.view") ? invoices : null,
        unpaidInvoices: can("invoice.view") ? unpaidInvoices : null,
        activeTariffs: can("tariff.view") ? activeTariffs : null,
      },
      statusCounts: can("shipment.view") ? statusCounts : {},
      revenueVerified: revenueAgg._sum.amount ?? 0,
      recentShipments: recentShipments.map((s) => ({
        id: s.id,
        masterCode: s.masterCode,
        status: s.status,
        origin: s.origin,
        destination: s.destination,
        customerName: s.customer.name,
        createdAt: s.createdAt,
      })),
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityLabel: a.entityLabel,
        actorName: a.actor?.name ?? "System",
        createdAt: a.createdAt,
      })),
    });
  });
}
