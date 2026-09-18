import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str } from "@/lib/api-helpers";
import { walletSummary } from "@/lib/wallet";

/**
 * GET /api/v1/partners — company-side partner list with wallets (§34
 * "Partner Wallets"). Requires partner.view (Admin Kantor / Owner).
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "partner.view");
    const params = req.nextUrl.searchParams;
    const type = str(params.get("type"));
    const partners = await db.partner.findMany({
      where: { ...(type ? { type } : {}) },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, name: true, username: true, isActive: true } },
        _count: { select: { vehicles: true, commissions: true, transportSettlements: true, topUps: true, withdrawals: true, repairs: true } },
      },
    });

    const withWallets = await Promise.all(
      partners.map(async (p) => {
        const summary = await walletSummary(p.id);
        const earnings = await db.walletTransaction.aggregate({
          where: { wallet: { partnerId: p.id }, type: "TRANSPORT_PROFIT_SHARE", direction: "CREDIT" },
          _sum: { amount: true },
        });
        const commissions = await db.walletTransaction.aggregate({
          where: { wallet: { partnerId: p.id }, type: "COMMISSION", direction: "CREDIT" },
          _sum: { amount: true },
        });
        const repairs = await db.walletTransaction.aggregate({
          where: { wallet: { partnerId: p.id }, type: "REPAIR_DEDUCTION", direction: "DEBIT" },
          _sum: { amount: true },
        });
        const withdrawals = await db.walletTransaction.aggregate({
          where: { wallet: { partnerId: p.id }, type: "WITHDRAWAL", direction: "DEBIT" },
          _sum: { amount: true },
        });
        // Per-source earnings breakdown — shipment (commission) vs transport
        // (profit share). Both come from the wallet ledger; their sum is the
        // partner's total earnings from the company.
        const shipmentEarnings = commissions._sum.amount ?? 0;
        const transportEarnings = earnings._sum.amount ?? 0;
        return {
          id: p.id,
          userId: p.user.id,
          name: p.user.name,
          username: p.user.username,
          userActive: p.user.isActive,
          type: p.type,
          profitShare: { company: p.companyPercent, partner: p.partnerPercent },
          bank: { bankName: p.bankName, bankAccountName: p.bankAccountName, bankAccountNumber: p.bankAccountNumber },
          isActive: p.isActive,
          notes: p.notes,
          wallet: summary,
          totals: {
            transportEarnings,
            commissions: shipmentEarnings,
            repairDeductions: repairs._sum.amount ?? 0,
            withdrawals: withdrawals._sum.amount ?? 0,
          },
          // Combined earnings summary — shows BOTH sources regardless of
          // partner type so the company can see at a glance how much each
          // partner earned from shipment commission AND from transport.
          earningsSummary: {
            shipment: shipmentEarnings,
            transport: transportEarnings,
            total: Math.round((shipmentEarnings + transportEarnings) * 100) / 100,
          },
          counts: {
            vehicles: p._count.vehicles,
            commissions: p._count.commissions,
            settlements: p._count.transportSettlements,
            topUps: p._count.topUps,
            withdrawals: p._count.withdrawals,
            repairs: p._count.repairs,
          },
        };
      }),
    );
    void user;
    return ok(withWallets);
  });
}
