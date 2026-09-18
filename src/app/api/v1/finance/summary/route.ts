import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle } from "@/lib/api-helpers";

/**
 * GET /api/v1/finance/summary — company financial dashboard (§33/§34):
 * aggregate partner wallet totals, pending workflows (top-ups, withdrawals,
 * repairs, commissions), monthly ledger breakdown. Requires
 * financial.report.view (Admin Kantor / Owner Company).
 *
 * PROFIT CLARIFICATION (Revision 6): Every Rupiah the customer pays against
 * a B2B invoice — whether the invoice ends up FULLY SETTLED or stays
 * PARTIALLY_SETTLED — is REALIZED COMPANY PROFIT at the moment it is
 * received. The company owns the invoice (§2) and never owes the Marketing
 * partner until the invoice is fully paid (§9), so partial payments sit in
 * the company's bank and are NOT offset by any partner liability. To make
 * this explicit in the dashboard, the summary now returns `invoicePayments`
 * (totals grouped by SETTLED vs PARTIALLY_SETTLED + a list of the most
 * recent settlement rows) and `totals.realizedInvoicePayments`.
 *
 * Visibility: only `financial.report.view` holders (Admin Kantor + Owner).
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "financial.report.view");

    const [
      partners,
      pendingTopUps,
      pendingWithdrawals,
      recentRepairs,
      pendingCommissions,
      verifiedTopUpAgg,
      commissionAgg,
      transportShareAgg,
      repairDeductionAgg,
      withdrawalAgg,
      // --- Revision 6: invoice payment profit (incl. partial) -----------------
      settledInvoiceAgg,
      partialInvoiceAgg,
      recentInvoiceSettlements,
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
        where: { status: "PENDING_VERIFICATION" },
        orderBy: { createdAt: "desc" },
        include: { partner: { include: { user: { select: { name: true } } } } },
      }),
      db.withdrawalRequest.findMany({
        where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
        orderBy: { createdAt: "desc" },
        include: { partner: { include: { user: { select: { name: true } } } } },
      }),
      // No approval workflow anymore — show the latest repair records
      // (all of them are VERIFIED at creation).
      db.vehicleRepair.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
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
      // Total paid against SETTLED invoices (full payments).
      db.invoiceSettlement.aggregate({
        where: { invoice: { status: "SETTLED" } },
        _sum: { amount: true },
      }),
      // Total paid against PARTIALLY_SETTLED invoices (partial payments —
      // still realized company profit; the unpaid remainder is the
      // outstanding receivable, NOT a partner liability).
      db.invoiceSettlement.aggregate({
        where: { invoice: { status: "PARTIALLY_SETTLED" } },
        _sum: { amount: true },
      }),
      db.invoiceSettlement.findMany({
        orderBy: { settledAt: "desc" },
        take: 8,
        include: { invoice: { select: { invoiceNumber: true, status: true, customer: { select: { name: true, companyName: true } } } } },
      }),
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

    // Also break down invoice payments by month (realized company profit
    // timeline — independent of the wallet ledger, because invoice payments
    // are CASH the company keeps, not wallet balances that flow to partners).
    const settledTotalSum = settledInvoiceAgg._sum.amount ?? 0;
    const partialTotalSum = partialInvoiceAgg._sum.amount ?? 0;
    const realizedInvoicePayments = settledTotalSum + partialTotalSum;
    const invoicePaymentByMonth = new Map<string, { settled: number; partial: number }>();
    for (const s of recentInvoiceSettlements) {
      const key = `${s.settledAt.getFullYear()}-${String(s.settledAt.getMonth() + 1).padStart(2, "0")}`;
      if (!invoicePaymentByMonth.has(key)) invoicePaymentByMonth.set(key, { settled: 0, partial: 0 });
      const bucket = invoicePaymentByMonth.get(key)!;
      if (s.invoice.status === "SETTLED") bucket.settled += s.amount;
      else bucket.partial += s.amount;
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
        // Revision 6 — invoice payments are realized company profit the
        // moment they're received (full or partial).
        realizedInvoicePayments,
        settledInvoicePayments: settledTotalSum,
        partialInvoicePayments: partialTotalSum,
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
        repairs: recentRepairs.map((r) => ({
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
      // Revision 6 — explicit invoice payment profit section. Partial
      // payments are flagged so the dashboard can show them as already-
      // realized cash, NOT as outstanding receivables.
      invoicePayments: {
        realized: realizedInvoicePayments,
        settledTotal: settledTotalSum,
        partialTotal: partialTotalSum,
        recent: recentInvoiceSettlements.map((s) => ({
          id: s.id,
          amount: s.amount,
          method: s.method,
          reference: s.reference,
          hasProof: !!s.proofUrl,
          settledAt: s.settledAt,
          invoiceNumber: s.invoice.invoiceNumber,
          invoiceStatus: s.invoice.status,
          customerName: s.invoice.customer.companyName ?? s.invoice.customer.name,
        })),
        byMonth: Array.from(invoicePaymentByMonth.entries()).map(([month, v]) => ({ month, ...v })),
      },
      monthlyLedger: Array.from(byMonth.entries()).map(([month, byType]) => ({ month, byType })),
    });
  });
}
