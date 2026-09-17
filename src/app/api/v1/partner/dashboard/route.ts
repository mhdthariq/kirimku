import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { requirePartner, walletSummary } from "@/lib/wallet";

/**
 * GET /api/v1/partner/dashboard — Vehicle Owner dashboard (§17):
 * Available Balance, Total Earnings, Total Transport Count, Total Repair
 * Deductions, Total Withdrawals, My Vehicles (with status breakdown), Recent
 * Transport, Full list of Repairs (not just action log), Recent Wallet
 * Transactions — all scoped to the OWN partner (§39).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.view_own");
    const partner = requirePartner(user, "VEHICLE_OWNER");

    const [summary, vehicles, settlements, repairAgg, withdrawalAgg, transactions, recentRepairLogs, repairs] = await Promise.all([
      walletSummary(partner.id),
      db.vehicle.findMany({
        where: { ownerId: partner.id },
        orderBy: { vehicleNumber: "asc" },
        select: { id: true, vehicleNumber: true, name: true, status: true, maxWeightKg: true, maxVolumeM3: true },
      }),
      db.transportSettlement.findMany({
        where: { ownerId: partner.id },
        orderBy: { finalizedAt: "desc" },
        take: 5,
        include: {
          transport: { select: { transportCode: true, origin: true, destination: true, arrivedAt: true } },
          vehicle: { select: { vehicleNumber: true } },
        },
      }),
      db.vehicleRepair.aggregate({ where: { ownerId: partner.id, status: "VERIFIED" }, _sum: { amount: true } }),
      db.withdrawalRequest.aggregate({ where: { partnerId: partner.id, status: "COMPLETED" }, _sum: { amount: true } }),
      db.walletTransaction.findMany({
        where: { wallet: { partnerId: partner.id } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      // Recent repair action-log entries — the VO sees create/update/delete
      // activity on their records without any approval workflow.
      db.repairActionLog.findMany({
        where: { ownerId: partner.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      // FULL list of the partner's repair records (not just the action log).
      // Sorted by repairDate desc so the most recent repairs appear first.
      db.vehicleRepair.findMany({
        where: { ownerId: partner.id, status: "VERIFIED" },
        orderBy: { repairDate: "desc" },
        include: {
          vehicle: { select: { id: true, vehicleNumber: true, name: true } },
        },
      }),
    ]);

    const earningsAgg = await db.walletTransaction.aggregate({
      where: { wallet: { partnerId: partner.id }, type: "TRANSPORT_PROFIT_SHARE", direction: "CREDIT" },
      _sum: { amount: true },
    });
    const transportCount = await db.transportSettlement.count({ where: { ownerId: partner.id } });
    // Pending withdrawals (reserved balance) — shown on the dashboard so the
    // VO can see at a glance how much is currently being processed.
    const pendingWithdrawals = await db.withdrawalRequest.aggregate({
      where: { partnerId: partner.id, status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
      _sum: { amount: true },
    });

    // Per-vehicle status breakdown — count vehicles by ACTIVE / MAINTENANCE / INACTIVE.
    const vehicleStatusBreakdown = vehicles.reduce(
      (acc, v) => {
        const key = v.status in acc ? v.status : "OTHER";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { ACTIVE: 0, MAINTENANCE: 0, INACTIVE: 0, OTHER: 0 } as Record<string, number>,
    );

    return ok({
      wallet: summary,
      totals: {
        earnings: earningsAgg._sum.amount ?? 0,
        transportCount,
        repairDeductions: repairAgg._sum.amount ?? 0,
        withdrawals: withdrawalAgg._sum.amount ?? 0,
        pendingWithdrawals: pendingWithdrawals._sum.amount ?? 0,
      },
      vehicles,
      vehicleStatusBreakdown,
      recentSettlements: settlements,
      recentTransactions: transactions,
      recentRepairLogs,
      repairs: repairs.map((r) => ({
        id: r.id,
        repairCode: r.repairCode,
        vehicleId: r.vehicleId,
        description: r.description,
        amount: r.amount,
        repairDate: r.repairDate,
        workshopVendor: r.workshopVendor,
        proofUrl: r.proofUrl,
        notes: r.notes,
        status: r.status,
        deductedAmount: r.deductedAmount,
        verifiedAt: r.verifiedAt,
        createdAt: r.createdAt,
        vehicle: r.vehicle,
      })),
    });
  });
}
