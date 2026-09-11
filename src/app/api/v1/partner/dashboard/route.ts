import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";
import { requirePartner, walletSummary } from "@/lib/wallet";

/**
 * GET /api/v1/partner/dashboard — Vehicle Owner dashboard (§17):
 * Available Balance, Total Earnings, Total Transport Count, Total Repair
 * Deductions, Total Withdrawals, My Vehicles, Recent Transport, Recent
 * Wallet Transactions — all scoped to the OWN partner (§39).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.view_own");
    const partner = requirePartner(user, "VEHICLE_OWNER");

    const [summary, vehicles, settlements, repairAgg, withdrawalAgg, transactions, pendingRepairs] = await Promise.all([
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
      db.vehicleRepair.count({ where: { ownerId: partner.id, status: { in: ["PENDING_CONFIRMATION", "OWNER_CONFIRMED"] } } }),
    ]);

    const earningsAgg = await db.walletTransaction.aggregate({
      where: { wallet: { partnerId: partner.id }, type: "TRANSPORT_PROFIT_SHARE", direction: "CREDIT" },
      _sum: { amount: true },
    });
    const transportCount = await db.transportSettlement.count({ where: { ownerId: partner.id } });

    return ok({
      wallet: summary,
      totals: {
        earnings: earningsAgg._sum.amount ?? 0,
        transportCount,
        repairDeductions: repairAgg._sum.amount ?? 0,
        withdrawals: withdrawalAgg._sum.amount ?? 0,
      },
      vehicles,
      recentSettlements: settlements,
      recentTransactions: transactions,
      pendingRepairs,
    });
  });
}
