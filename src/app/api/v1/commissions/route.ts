import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { requirePartner } from "@/lib/wallet";
import { str } from "@/lib/api-helpers";

/**
 * GET /api/v1/commissions — Marketing's own B2B commission list (§40:
 * "Marketing can see pending/earned commission status").
 * A Marketing user only ever sees their OWN commissions (§39).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.view_own");
    const partner = requirePartner(user, "MARKETING");
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    const commissions = await db.marketingCommission.findMany({
      where: { partnerId: partner.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: {
          include: {
            customer: { select: { name: true, companyName: true } },
            settlements: { select: { amount: true } },
            lines: { select: { shipmentId: true, quantity: true, unitPrice: true } },
          },
        },
      },
    });

    const rows = commissions.map((c) => {
      const settled = c.invoice.settlements.reduce((sum, s) => sum + s.amount, 0);
      const total = c.invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
      return {
        id: c.id,
        commissionCode: c.commissionCode,
        status: c.status,
        invoiceId: c.invoice.id,
        invoiceNumber: c.invoice.invoiceNumber,
        invoiceStatus: c.invoice.status,
        customerName: c.invoice.customer.companyName ?? c.invoice.customer.name,
        invoiceAmount: c.invoiceAmount,
        paidAmount: settled,
        remainingAmount: Math.max(0, total - settled),
        companyPercent: c.companyPercent,
        partnerPercent: c.partnerPercent,
        commissionAmount: c.commissionAmount,
        releasedAt: c.releasedAt,
        createdAt: c.createdAt,
        shipments: c.invoice.lines.filter((l) => l.shipmentId != null).length,
      };
    });
    return ok(rows);
  });
}
