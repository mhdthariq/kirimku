import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/auth";
import { cityIndex, filterAuditEntriesForScope, inScope, scopeForUser, shipmentGudangIds, pickupGudangIds, deliveryGudangIds, transportGudangIds } from "@/lib/gudang-scope";

/**
 * Owner / operational dashboard (Revise.md — Owner Dashboard redesign).
 *
 * Two priorities drive the layout:
 *   1. Approval Queue — items the owner must act on FIRST:
 *      - Top Up requests pending verification (PENDING_VERIFICATION)
 *      - Withdrawal requests pending review (PENDING)
 *      - Payments awaiting verification (RECORDED)
 *      - Marketing commission ready to release (PENDING, invoice fully settled)
 *   2. Operational info (filtered by the period calendar — same DatePeriodFilter
 *      used by the Kurir & Driver dashboards):
 *      - shipment counts (in period)
 *      - shipment status funnel (in period)
 *      - revenue verified (in period)
 *      - recent shipments (in period)
 *      - recent audit log (in period)
 *
 * Non-owner users (Admin Gudang, Marketing, …) get the same shape with their
 * own scoped data and an EMPTY approval queue (they don't have the
 * permissions to act on those items).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const can = (p: string) => hasPermission(user, p);

    // ---- period parsing (default: today, like kurir & driver dashboards) ----
    const todayStr = new Date().toISOString().slice(0, 10);
    const params = req.nextUrl.searchParams;
    const fromStr = str(params.get("from")) ?? todayStr;
    let toStr = str(params.get("to")) ?? fromStr;
    if (toStr < fromStr) toStr = fromStr;
    const from = new Date(`${fromStr}T00:00:00.000`);
    const to = new Date(`${toStr}T23:59:59.999`);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);

    // Gudang data separation: operational counters & recent lists are scoped
    // to the user's gudang (only the owner sees company-wide numbers).
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();

    const [customers, shipmentRows, pickupRows, deliveryRows, transportRows, vehicles, gudang, routes, invoices, unpaidInvoices, activeTariffs] =
      await Promise.all([
        can("customer.view")
          ? db.customer.count({ where: { isActive: true, createdAt: { gte: from, lte: to } } })
          : Promise.resolve(null as number | null),
        can("shipment.view")
          ? db.masterShipment.findMany({
              where: { createdAt: { gte: from, lte: to } },
              select: { id: true, status: true, masterCode: true, origin: true, destination: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, createdAt: true, customer: { select: { name: true } } },
            })
          : Promise.resolve([]),
        can("pickup.view")
          ? db.pickup.findMany({ where: { status: { in: ["ASSIGNED", "IN_PROGRESS", "PICKED_UP"] }, createdAt: { gte: from, lte: to } }, select: { id: true, master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } })
          : Promise.resolve([]),
        can("delivery.view")
          ? db.delivery.findMany({ where: { status: "ASSIGNED", createdAt: { gte: from, lte: to } }, select: { id: true, master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } })
          : Promise.resolve([]),
        can("transport.view")
          ? db.transport.findMany({ where: { status: "DEPARTED", departedAt: { gte: from, lte: to } }, select: { id: true, route: { select: { origin: true, destination: true } }, shipments: { select: { master: { select: { status: true, originWarehouseId: true, destinationWarehouseId: true, arrivedWarehouseId: true, origin: true, destination: true } } } } } })
          : Promise.resolve([]),
        can("vehicle.view") ? db.vehicle.count() : null as number | null,
        can("warehouse.view") ? db.warehouse.count({ where: { isActive: true } }) : null as number | null,
        can("checkpoint.view") ? db.route.count({ where: { isActive: true } }) : null as number | null,
        can("invoice.view") ? db.invoice.count({ where: { createdAt: { gte: from, lte: to } } }) : null as number | null,
        can("invoice.view") ? db.invoice.count({ where: { status: { in: ["SENT", "PARTIALLY_SETTLED"] } } }) : null as number | null,
        can("tariff.view") ? db.tariff.count({ where: { isActive: true } }) : null as number | null,
      ]);

    const scopedShipments = shipmentRows.filter((s) => inScope(shipmentGudangIds(s, cityIdx), scope));
    const scopedPickups = pickupRows.filter((p) => inScope(pickupGudangIds(p.master, cityIdx), scope));
    const scopedDeliveries = deliveryRows.filter((d) => inScope(deliveryGudangIds(d.master, cityIdx), scope));
    const scopedTransports = transportRows.filter((t) => inScope(transportGudangIds(t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master), cityIdx), scope));

    const statusCounts: Record<string, number> = {};
    for (const s of scopedShipments) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

    const recentShipments = scopedShipments.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6);

    // ---- approval queue (owner / approver permissions only) ----------------
    // Each item the owner can act on. Other users get an empty list — they
    // don't have the permissions to verify / approve anything.
    const [pendingTopups, pendingWithdrawals, pendingPayments, pendingCommissions] =
      await Promise.all([
        can("wallet.topup.verify")
          ? db.topUpRequest.findMany({
              where: { status: "PENDING_VERIFICATION" },
              orderBy: { submittedForVerificationAt: "desc" },
              take: 10,
              include: { partner: { include: { user: { select: { name: true, username: true } } } } },
            })
          : Promise.resolve([]),
        can("wallet.withdrawal.view") && (user.isOwner || can("wallet.withdrawal.approve"))
          ? db.withdrawalRequest.findMany({
              where: { status: "PENDING" },
              orderBy: { createdAt: "desc" },
              take: 10,
              include: { partner: { include: { user: { select: { name: true, username: true } } } } },
            })
          : Promise.resolve([]),
        can("payment.verify")
          ? db.payment.findMany({
              where: { status: "RECORDED", createdAt: { gte: from, lte: to } },
              orderBy: { createdAt: "desc" },
              take: 10,
              include: { master: { select: { masterCode: true, customer: { select: { name: true } } } }, recordedBy: { select: { name: true } } },
            })
          : Promise.resolve([]),
        user.isOwner || can("invoice.send")
          ? db.marketingCommission.findMany({
              where: { status: "PENDING" },
              orderBy: { createdAt: "desc" },
              take: 10,
              include: { partner: { include: { user: { select: { name: true } } } }, invoice: { select: { invoiceNumber: true, status: true } } },
            })
          : Promise.resolve([]),
      ]);

    const auditRows = can("audit_log.view")
      ? await db.auditLog.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: "desc" },
          take: scope.unscoped ? 8 : 100,
          include: { actor: true },
        })
      : [];
    const auditFlags = scope.unscoped ? [] : await filterAuditEntriesForScope(auditRows, scope);
    const auditVisible = scope.unscoped ? auditRows : auditRows.filter((_, index) => auditFlags[index]);

    const visibleShipmentIds = scopedShipments.map((s) => s.id);

    const revenueAgg = await db.payment.aggregate({
      where: {
        status: "VERIFIED",
        verifiedAt: { gte: from, lte: to },
        ...(scope.unscoped ? {} : { masterId: { in: visibleShipmentIds } }),
      },
      _sum: { amount: true },
    });

    return ok({
      period: { from: fromStr, to: toStr, days },
      approvals: {
        pendingTopups: pendingTopups.map((t) => ({
          id: t.id,
          requestCode: t.requestCode,
          amount: t.amount,
          partnerName: t.partner?.user?.name ?? "—",
          partnerType: t.partner?.type ?? "MARKETING",
          submittedAt: t.submittedForVerificationAt ?? t.createdAt,
          proofUrl: t.proofUrl,
        })),
        pendingWithdrawals: pendingWithdrawals.map((w) => ({
          id: w.id,
          requestCode: w.requestCode,
          amount: w.amount,
          partnerName: w.partner?.user?.name ?? "—",
          partnerType: w.partner?.type ?? "VEHICLE_OWNER",
          bankName: w.bankName,
          bankAccountName: w.bankAccountName,
          bankAccountNumber: w.bankAccountNumber,
          createdAt: w.createdAt,
        })),
        pendingPayments: pendingPayments.map((p) => ({
          id: p.id,
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          masterCode: p.master?.masterCode ?? "—",
          customerName: p.master?.customer?.name ?? "—",
          recordedByName: p.recordedBy?.name ?? "—",
          createdAt: p.createdAt,
        })),
        pendingCommissions: pendingCommissions.map((c) => ({
          id: c.id,
          commissionCode: c.commissionCode,
          amount: c.commissionAmount,
          partnerName: c.partner?.user?.name ?? "—",
          invoiceNumber: c.invoice?.invoiceNumber ?? "—",
          invoiceStatus: c.invoice?.status ?? "—",
          createdAt: c.createdAt,
        })),
      },
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
      recentAudit: auditVisible.slice(0, 8).map((a) => ({
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
