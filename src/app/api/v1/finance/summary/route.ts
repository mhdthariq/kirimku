import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";

/**
 * GET /api/v1/finance/summary — company financial dashboard (§33/§34):
 * aggregate partner wallet totals, pending workflows (top-ups, withdrawals,
 * repairs, commissions), monthly ledger breakdown. Requires
 * financial.report.view (Admin Kantor / Owner Company).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "financial.report.view");

    const [
      partners,
      pendingTopUps,
      pendingWithdrawals,
      pendingRepairs,
      pendingCommissions,
      verifiedTopUpAgg,
      commissionAgg,
      transportShareAgg,
      repairDeductionAgg,
      withdrawalAgg,
    ] = await Promise.all([
      db.partner.findMany({
        include: {
          user: { select: { name: true, username: true } },
          wallet: true,
          _count: { select: { vehicles: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.topUpRequest.findMany({
        where: { status: { in: ["PENDING_PAYMENT", "PENDING_VERIFICATION"] } },
        orderBy: { createdAt: "desc" },
        include: { partner: { include: { user: { select: { name: true } } } } },
      }),
      db.withdrawalRequest.findMany({
        where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
        orderBy: { createdAt: "desc" },
        include: { partner: { include: { user: { select: { name: true } } } } },
      }),
      db.vehicleRepair.findMany({
        where: { status: { in: ["PENDING_CONFIRMATION", "OWNER_CONFIRMED"] } },
        orderBy: { createdAt: "desc" },
        include: { vehicle: { select: { vehicleNumber: true } }, owner: { include: { user: { select: { name: true } } } } },
      }),
      db.marketingCommission.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        include: { invoice: { select: { invoiceNumber: true } }, partner: { include: { user: { select: { name: true } } } } },
      }),
      db.topUpRequest.aggregate({ where: { status: "VERIFIED" }, _sum: { amount: true } }),
      db.marketingCommission.aggregate({ where: { status: "RELEASED" }, _sum: { commissionAmount: true } }),
      db.transportSettlement.aggregate({ _sum: { ownerAmount: true, transportValue: true } }),
      db.vehicleRepair.aggregate({ where: { status: "VERIFIED" }, _sum: { amount: true } }),
      db.withdrawalRequest.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true } }),
    ]);

    const unsettledArrivedTransports = await db.transport.count({
      where: { status: "ARRIVED", vehicle: { ownerId: { not: null } }, settlement: null },
    });

    const totalWalletBalance = partners.reduce((sum, p) => sum + (p.wallet?.balance ?? 0), 0);
    const totalReserved = partners.reduce((sum, p) => {
      const pending = pendingWithdrawals.filter((w) => w.partnerId === p.id).reduce((s, w) => s + w.amount, 0);
      return sum + pending;
    }, 0);

    // Monthly ledger breakdown (last 6 months, per type)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const ledger = await db.walletTransaction.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      orderBy: { createdAt: "asc" },
    });
    const byMonth = new Map<string, Record<string, number>>();
    for (const tx of ledger) {
      const key = `${tx.createdAt.getFullYear()}-${String(tx.createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(key)) byMonth.set(key, {});
      const month = byMonth.get(key)!;
      month[tx.type] = (month[tx.type] ?? 0) + (tx.direction === "CREDIT" ? tx.amount : -tx.amount);
    }

    void user;
    return ok({
      totals: {
        partnerCount: partners.length,
        marketingCount: partners.filter((p) => p.type === "MARKETING").length,
        vehicleOwnerCount: partners.filter((p) => p.type === "VEHICLE_OWNER").length,
        totalWalletBalance,
        totalReserved,
        totalAvailable: Math.max(0, totalWalletBalance - totalReserved),
        verifiedTopUps: verifiedTopUpAgg._sum.amount ?? 0,
        releasedCommissions: commissionAgg._sum.commissionAmount ?? 0,
        transportSharePaid: transportShareAgg._sum.ownerAmount ?? 0,
        transportValueSettled: transportShareAgg._sum.transportValue ?? 0,
        repairDeductions: repairDeductionAgg._sum.amount ?? 0,
        withdrawalsCompleted: withdrawalAgg._sum.amount ?? 0,
        unsettledArrivedTransports,
      },
      pending: {
        topUps: pendingTopUps.map((t) => ({
          id: t.id,
          requestCode: t.requestCode,
          partnerName: t.partner.user.name,
          partnerType: t.partner.type,
          amount: t.amount,
          status: t.status,
          createdAt: t.createdAt,
        })),
        withdrawals: pendingWithdrawals.map((w) => ({
          id: w.id,
          requestCode: w.requestCode,
          partnerName: w.partner.user.name,
          partnerType: w.partner.type,
          amount: w.amount,
          status: w.status,
          bankName: w.bankName,
          bankAccountNumber: w.bankAccountNumber,
          createdAt: w.createdAt,
        })),
        repairs: pendingRepairs.map((r) => ({
          id: r.id,
          repairCode: r.repairCode,
          vehicleNumber: r.vehicle.vehicleNumber,
          ownerName: r.owner.user.name,
          amount: r.amount,
          status: r.status,
          createdAt: r.createdAt,
        })),
        commissions: pendingCommissions.map((c) => ({
          id: c.id,
          commissionCode: c.commissionCode,
          partnerName: c.partner.user.name,
          invoiceNumber: c.invoice.invoiceNumber,
          commissionAmount: c.commissionAmount,
          createdAt: c.createdAt,
        })),
      },
      partners: partners.map((p) => ({
        id: p.id,
        name: p.user.name,
        username: p.user.username,
        type: p.type,
        profitShare: { company: p.companyPercent, partner: p.partnerPercent },
        walletBalance: p.wallet?.balance ?? 0,
        vehicleCount: p._count.vehicles,
      })),
      monthlyLedger: Array.from(byMonth.entries()).map(([month, byType]) => ({ month, byType })),
    });
  });
}
