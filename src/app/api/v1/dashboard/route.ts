import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";
import { hasPermission, type AuthUser } from "@/lib/auth";
import { cityIndex, filterAuditEntriesForScope, inScope, scopeForUser, shipmentGudangIds, pickupGudangIds, deliveryGudangIds, transportGudangIds } from "@/lib/gudang-scope";
import { computeTotals } from "@/lib/shipment-totals";
import { walletSummary, requirePartner } from "@/lib/wallet";

/**
 * Owner / operational dashboard (Revise.md — Owner Dashboard redesign).
 *
 * Role-aware:
 *   - owner / admin-kantor   → full operational view + approval queue
 *   - admin-gudang / staff-gudang → gudang workspace (arrival scan queue,
 *       transport arrivals, walk-ins, held packages) for THEIR gudang
 *   - marketing              → own shipments, customers, B2B commission,
 *       wallet snapshot (NO approval cards — Marketing can't approve anything)
 *
 * Approval cards are returned EMPTY unless the user actually holds the
 * permission to act on them. The frontend uses the per-card permission flags
 * (`canVerifyTopup`, `canApproveWithdrawal`, `canVerifyPayment`,
 * `canReleaseCommission`) to decide whether to render the card at all —
 * Marketing thus never sees the Withdrawal / Top Up / Payment Verify /
 * Commission cards.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const can = (p: string) => hasPermission(user, p);

    // ---- role detection -----------------------------------------------------
    const role = detectRole(user);

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

    // ---- Marketing: own shipments / customers / commissions / wallet --------
    // Marketing is a Partner, not an Employee → gudang scope yields nothing
    // for them. We bypass gudang scoping and filter by createdByPartnerId so
    // the dashboard actually shows the Marketing partner's data.
    const isMarketingPartner = role === "marketing";

    const [customers, shipmentRows, pickupRows, deliveryRows, transportRows, vehicles, gudang, routes, invoices, unpaidInvoices, activeTariffs] =
      await Promise.all([
        can("customer.view")
          ? db.customer.count({
              where: {
                isActive: true,
                createdAt: { gte: from, lte: to },
                ...(isMarketingPartner && user.partnerId ? { marketingPartnerId: user.partnerId } : {}),
              },
            })
          : Promise.resolve(null as number | null),
        can("shipment.view")
          ? db.masterShipment.findMany({
              where: {
                createdAt: { gte: from, lte: to },
                ...(isMarketingPartner && user.partnerId ? { createdByPartnerId: user.partnerId } : {}),
              },
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

    // For Marketing partners we already filtered at the DB level — skip gudang
    // scoping (they would otherwise see no data).
    const scopedShipments = isMarketingPartner
      ? shipmentRows
      : shipmentRows.filter((s) => inScope(shipmentGudangIds(s, cityIdx), scope));
    const scopedPickups = isMarketingPartner ? pickupRows : pickupRows.filter((p) => inScope(pickupGudangIds(p.master, cityIdx), scope));
    const scopedDeliveries = isMarketingPartner ? deliveryRows : deliveryRows.filter((d) => inScope(deliveryGudangIds(d.master, cityIdx), scope));
    const scopedTransports = isMarketingPartner ? transportRows : transportRows.filter((t) => inScope(transportGudangIds(t.route ?? { origin: null, destination: null }, t.shipments.map((s) => s.master), cityIdx), scope));

    const statusCounts: Record<string, number> = {};
    for (const s of scopedShipments) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

    const recentShipments = scopedShipments.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6);

    // ---- approval queue (owner / approver permissions only) ----------------
    // Each approval card is only returned when the user has the matching
    // permission; the frontend can thus render ONLY the cards they can act on.
    const canVerifyTopup = can("wallet.topup.verify");
    const canApproveWithdrawal = user.isOwner || can("wallet.withdrawal.approve");
    const canReviewWithdrawal = can("wallet.withdrawal.view");
    const canVerifyPayment = can("payment.verify");
    const canReleaseCommission = user.isOwner || can("invoice.send");

    const [pendingTopups, pendingWithdrawals, pendingPayments, pendingCommissions] =
      await Promise.all([
        canVerifyTopup
          ? db.topUpRequest.findMany({
              where: { status: "PENDING_VERIFICATION" },
              orderBy: { submittedForVerificationAt: "desc" },
              take: 10,
              include: { partner: { include: { user: { select: { name: true, username: true } } } } },
            })
          : Promise.resolve([]),
        canReviewWithdrawal && canApproveWithdrawal
          ? db.withdrawalRequest.findMany({
              where: { status: "PENDING" },
              orderBy: { createdAt: "desc" },
              take: 10,
              include: { partner: { include: { user: { select: { name: true, username: true } } } } },
            })
          : Promise.resolve([]),
        canVerifyPayment
          ? db.payment.findMany({
              where: { status: "RECORDED", createdAt: { gte: from, lte: to } },
              orderBy: { createdAt: "desc" },
              take: 10,
              include: { master: { select: { masterCode: true, customer: { select: { name: true } } } }, recordedBy: { select: { name: true } } },
            })
          : Promise.resolve([]),
        canReleaseCommission
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
        ...(scope.unscoped || isMarketingPartner ? {} : { masterId: { in: visibleShipmentIds } }),
      },
      _sum: { amount: true },
    });

    // ---- Marketing-specific extras -----------------------------------------
    // The Marketing dashboard shows the partner's own wallet snapshot +
    // B2B commission pipeline so they have everything on one screen.
    let marketingSnapshot: MarketingSnapshot | null = null;
    if (isMarketingPartner && user.partnerId) {
      try {
        const partner = requirePartner(user, "MARKETING");
        const [summary, commissionRows, walletTx, withdrawalRows] = await Promise.all([
          walletSummary(partner.id),
          db.marketingCommission.findMany({
            where: { partnerId: partner.id },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { invoice: { select: { invoiceNumber: true, status: true, customer: { select: { name: true } } } } },
          }),
          db.walletTransaction.findMany({
            where: { wallet: { partnerId: partner.id } },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          db.withdrawalRequest.findMany({
            where: { partnerId: partner.id, status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
        ]);
        const pendingCommission = commissionRows
          .filter((c) => c.status === "PENDING")
          .reduce((sum, c) => sum + c.commissionAmount, 0);
        const releasedCommission = await db.walletTransaction.aggregate({
          where: { wallet: { partnerId: partner.id }, type: "COMMISSION", direction: "CREDIT" },
          _sum: { amount: true },
        });
        marketingSnapshot = {
          wallet: summary,
          pendingCommission,
          releasedCommission: releasedCommission._sum.amount ?? 0,
          recentCommissions: commissionRows.map((c) => ({
            id: c.id,
            commissionCode: c.commissionCode,
            status: c.status,
            amount: c.commissionAmount,
            invoiceNumber: c.invoice?.invoiceNumber ?? "-",
            invoiceStatus: c.invoice?.status ?? "-",
            customerName: c.invoice?.customer?.name ?? "-",
            createdAt: c.createdAt,
          })),
          recentTransactions: walletTx.map((t) => ({
            id: t.id,
            type: t.type,
            amount: t.amount,
            direction: t.direction,
            description: t.description,
            businessRef: t.businessRef,
            createdAt: t.createdAt,
          })),
          pendingWithdrawals: withdrawalRows.map((w) => ({
            id: w.id,
            requestCode: w.requestCode,
            amount: w.amount,
            status: w.status,
            createdAt: w.createdAt,
          })),
        };
      } catch {
        marketingSnapshot = null;
      }
    }

    // ---- Gudang workspace (admin-gudang / staff-gudang) --------------------
    // Reuse the same /gudang endpoint shape so the dashboard surfaces the
    // Admin Gudang's scan queue (arrival queue + transport arrivals + walk-ins)
    // and the per-gudang held-package summary.
    let gudangWorkspace: GudangDashboardWorkspace | null = null;
    if (role === "admin-gudang" || role === "staff-gudang" || user.isOwner) {
      try {
        gudangWorkspace = await buildGudangWorkspace(user, scope);
      } catch {
        gudangWorkspace = null;
      }
    }

    return ok({
      role,
      permissions: {
        canVerifyTopup,
        canApproveWithdrawal,
        canReviewWithdrawal,
        canVerifyPayment,
        canReleaseCommission,
      },
      period: { from: fromStr, to: toStr, days },
      approvals: {
        pendingTopups: pendingTopups.map((t) => ({
          id: t.id,
          requestCode: t.requestCode,
          amount: t.amount,
          partnerName: t.partner?.user?.name ?? "-",
          partnerType: t.partner?.type ?? "MARKETING",
          submittedAt: t.submittedForVerificationAt ?? t.createdAt,
          proofUrl: t.proofUrl,
        })),
        pendingWithdrawals: pendingWithdrawals.map((w) => ({
          id: w.id,
          requestCode: w.requestCode,
          amount: w.amount,
          partnerName: w.partner?.user?.name ?? "-",
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
          masterCode: p.master?.masterCode ?? "-",
          customerName: p.master?.customer?.name ?? "-",
          recordedByName: p.recordedBy?.name ?? "-",
          createdAt: p.createdAt,
        })),
        pendingCommissions: pendingCommissions.map((c) => ({
          id: c.id,
          commissionCode: c.commissionCode,
          amount: c.commissionAmount,
          partnerName: c.partner?.user?.name ?? "-",
          invoiceNumber: c.invoice?.invoiceNumber ?? "-",
          invoiceStatus: c.invoice?.status ?? "-",
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
      marketing: marketingSnapshot,
      gudang: gudangWorkspace,
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectRole(user: AuthUser): "owner" | "admin-kantor" | "marketing" | "admin-gudang" | "staff-gudang" {
  if (user.isOwner) return "owner";
  if (user.partnerType === "MARKETING") return "marketing";
  const slugs = user.roles.map((r) => r.slug);
  if (slugs.includes("admin-kantor")) return "admin-kantor";
  if (slugs.includes("admin-gudang")) return "admin-gudang";
  if (slugs.includes("staff-gudang")) return "staff-gudang";
  // default fallback — treat as admin-kantor (broadest non-owner view)
  return "admin-kantor";
}

interface MarketingSnapshot {
  wallet: { balance: number; reserved: number; available: number };
  pendingCommission: number;
  releasedCommission: number;
  recentCommissions: {
    id: number;
    commissionCode: string;
    status: string;
    amount: number;
    invoiceNumber: string;
    invoiceStatus: string;
    customerName: string;
    createdAt: Date;
  }[];
  recentTransactions: {
    id: number;
    type: string;
    amount: number;
    direction: string;
    description: string | null;
    businessRef: string;
    createdAt: Date;
  }[];
  pendingWithdrawals: {
    id: number;
    requestCode: string;
    amount: number;
    status: string;
    createdAt: Date;
  }[];
}

interface GudangDashboardWorkspace {
  scope: { warehouseId: number | null; warehouseName: string | null; scoped: boolean };
  arrivals: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    detailsCount: number;
    scannedCount: number;
    pickupCode: string | null;
    kurirName: string | null;
    updatedAt: Date;
  }[];
  transportArrivals: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    originWarehouseName: string | null;
    transportCode: string | null;
    driverName: string | null;
    detailsCount: number;
    scannedCount: number;
    updatedAt: Date;
  }[];
  walkIns: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    status: string;
    detailsCount: number;
    totalWeightKg: number;
  }[];
  heldSummary: {
    warehouseId: number;
    warehouseName: string;
    city: string | null;
    heldShipments: number;
    heldPackages: number;
    heldWeightKg: number;
    unpaidCount: number;
  }[];
}

async function buildGudangWorkspace(user: AuthUser, scope: { unscoped: boolean; warehouseId: number | null }): Promise<GudangDashboardWorkspace> {
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
      customer: { select: { name: true } },
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
  for (const scan of arrivalScanRows) {
    if (scan.detailId == null) continue;
    const mid = detailMaster.get(scan.detailId);
    if (mid == null) continue;
    scannedPerMaster.set(mid, (scannedPerMaster.get(mid) ?? 0) + 1);
  }
  const employees = await db.employee.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const employeeName = (id: number | null) => (id == null ? null : employees.find((e) => e.id === id)?.name ?? null);

  const arrivals = scopedArrivals.map((s) => {
    const totals = computeTotals(s.details);
    const lastPickup = s.pickups[0] ?? null;
    return {
      id: s.id,
      masterCode: s.masterCode,
      customerName: s.customer.name,
      origin: s.origin,
      destination: s.destination,
      detailsCount: totals.totalPackages,
      scannedCount: scannedPerMaster.get(s.id) ?? 0,
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
    .slice(0, 10)
    .map((s) => {
      const totals = computeTotals(s.details);
      return {
        id: s.id,
        masterCode: s.masterCode,
        customerName: s.customer.name,
        origin: s.origin,
        destination: s.destination,
        status: s.status,
        detailsCount: totals.totalPackages,
        totalWeightKg: totals.totalActualKg,
      };
    });

  // --- Transport arrivals: shipments that reached THIS gudang from another
  //     gudang via transport and still await the Admin Gudang scan-in.
  const transportArrivalRows = await db.masterShipment.findMany({
    where: {
      OR: [
        { status: "AT_DEST_GUDANG" },
        { status: "ARRIVED_AT_GUDANG", destReceivedAt: null },
      ],
    },
    orderBy: { updatedAt: "asc" },
    include: {
      customer: { select: { name: true } },
      details: { select: { id: true, actualWeightKg: true, lengthCm: true, widthCm: true, heightCm: true } },
      transportItems: {
        select: {
          transport: {
            select: { id: true, transportCode: true, createdAt: true, driver: { select: { name: true } }, kenek: { select: { name: true } } },
          },
        },
      },
    },
  });
  const scopedTransportArrivals = transportArrivalRows.filter((s) => {
    if (scope.unscoped) return true;
    if (scope.warehouseId == null) return false;
    if (s.arrivedWarehouseId != null) return s.arrivedWarehouseId === scope.warehouseId;
    if (s.destinationWarehouseId != null) return s.destinationWarehouseId === scope.warehouseId;
    const wh = warehouses.find((w) => w.id === scope.warehouseId);
    return !!wh && (s.destination ?? "").toLowerCase() === (wh.city ?? "").toLowerCase();
  });
  const transportArrivalIds = scopedTransportArrivals.map((s) => s.id);
  const transportArrivalScanRows = transportArrivalIds.length
    ? await db.handoverScan.findMany({
        where: { context: "transport_arrival", masterId: { in: transportArrivalIds }, result: { in: ["ok", "duplicate"] } },
        select: { detailId: true, method: true },
      })
    : [];
  const transportArrivalDetailMaster = new Map<number, number>();
  for (const s of scopedTransportArrivals) for (const d of s.details) transportArrivalDetailMaster.set(d.id, s.id);
  const transportArrivalScanned = new Map<number, number>();
  for (const scan of transportArrivalScanRows) {
    if (scan.detailId == null) continue;
    const mid = transportArrivalDetailMaster.get(scan.detailId);
    if (mid == null) continue;
    transportArrivalScanned.set(mid, (transportArrivalScanned.get(mid) ?? 0) + 1);
  }
  const transportArrivals = scopedTransportArrivals.slice(0, 10).map((s) => {
    const sorted = [...s.transportItems].sort(
      (a, b) => new Date(b.transport.createdAt).getTime() - new Date(a.transport.createdAt).getTime(),
    );
    const lastTransport = sorted[0]?.transport ?? null;
    const originWarehouseName =
      (s.originWarehouseId != null ? warehouses.find((w) => w.id === s.originWarehouseId)?.name : null) ?? null;
    return {
      id: s.id,
      masterCode: s.masterCode,
      customerName: s.customer.name,
      origin: s.origin,
      destination: s.destination,
      originWarehouseName,
      transportCode: lastTransport?.transportCode ?? null,
      driverName: lastTransport?.driver?.name ?? null,
      detailsCount: s.details.length,
      scannedCount: transportArrivalScanned.get(s.id) ?? 0,
      updatedAt: s.updatedAt,
    };
  });

  // --- Per-gudang held summary --------------------------------------------
  const heldShipments = await db.masterShipment.findMany({
    where: { status: { in: ["RECEIVED_AT_GUDANG", "AT_DEST_GUDANG", "ARRIVED_AT_GUDANG"] } },
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
  const warehouseScopes = warehouses
    .filter((w) => (scope.unscoped ? true : scope.warehouseId != null && w.id === scope.warehouseId))
    .map((w) => {
      const shipments = heldShipments.filter((s) => {
        if (s.status === "RECEIVED_AT_GUDANG") {
          if (s.arrivedWarehouseId != null) return s.arrivedWarehouseId === w.id;
          if (s.originWarehouseId != null) return s.originWarehouseId === w.id;
          return sameCity(s.origin, w.city);
        }
        if (s.arrivedWarehouseId != null) return s.arrivedWarehouseId === w.id;
        if (s.destinationWarehouseId != null) return s.destinationWarehouseId === w.id;
        return sameCity(s.destination, w.city);
      });
      const totals = shipments.map((s) => computeTotals(s.details));
      const packages = totals.reduce((sum, t) => sum + t.totalPackages, 0);
      const weight = totals.reduce((sum, t) => sum + t.totalActualKg, 0);
      const unpaid = shipments.filter((s) => {
        const finalPrice = s.finalPriceAmount ?? (s.priceAmount != null ? s.priceAmount - (s.discountAmount ?? 0) : null);
        const paid = heldPaid.get(s.id) ?? 0;
        return finalPrice != null && paid < finalPrice - 0.01;
      }).length;
      return {
        warehouseId: w.id,
        warehouseName: w.name,
        city: w.city,
        heldShipments: shipments.length,
        heldPackages: packages,
        heldWeightKg: Math.round(weight * 100) / 100,
        unpaidCount: unpaid,
      };
    });

  const scopeWarehouse = !scope.unscoped && scope.warehouseId != null ? warehouses.find((w) => w.id === scope.warehouseId) ?? null : null;
  return {
    scope: scopeWarehouse
      ? { warehouseId: scopeWarehouse.id, warehouseName: scopeWarehouse.name, scoped: true }
      : { warehouseId: null, warehouseName: null, scoped: false },
    arrivals,
    transportArrivals,
    walkIns,
    heldSummary: warehouseScopes,
  };
}
