import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/auth";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const can = (p: string) => hasPermission(user, p);

    const [customers, shipments, pickups, deliveries, transports, vehicles, gudang, routes, invoices, unpaidInvoices, activeTariffs] =
      await Promise.all([
        db.customer.count({ where: { isActive: true } }),
        db.masterShipment.count(),
        db.pickup.count({ where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } } }),
        db.delivery.count({ where: { status: "ASSIGNED" } }),
        db.transport.count({ where: { status: "DEPARTED" } }),
        db.vehicle.count(),
        db.warehouse.count({ where: { isActive: true } }),
        db.route.count({ where: { isActive: true } }),
        db.invoice.count(),
        db.invoice.count({ where: { status: { in: ["SENT", "PARTIALLY_SETTLED"] } } }),
        db.tariff.count({ where: { isActive: true } }),
      ]);

    const statusGroups = await db.masterShipment.groupBy({ by: ["status"], _count: { _all: true } });
    const statusCounts: Record<string, number> = {};
    for (const g of statusGroups) statusCounts[g.status] = g._count._all;

    const recentShipments = can("shipment.view")
      ? await db.masterShipment.findMany({
          orderBy: { createdAt: "desc" },
          take: 6,
          include: { customer: true },
        })
      : [];

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
        shipments: can("shipment.view") ? shipments : null,
        activePickups: can("pickup.view") ? pickups : null,
        pendingDeliveries: can("delivery.view") ? deliveries : null,
        inTransit: can("transport.view") ? transports : null,
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
