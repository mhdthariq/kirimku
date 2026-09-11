import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireNum, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * Record a settlement payment against a SENT invoice.
 *
 * Revise.md §8/§9/§30 — when this payment makes the invoice FULLY PAID
 * (status SETTLED) and a PENDING Marketing commission exists, the commission
 * is released to the Marketing wallet ATOMICALLY in the same DB transaction:
 *   invoice becomes SETTLED
 *   + commission transaction created (COMMISSION, businessRef COMM-{invoiceId})
 *   + Marketing wallet credited.
 * Partial payments leave the commission PENDING; duplicate callbacks cannot
 * double-credit (unique businessRef + status guard).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "payment.verify");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({ where: { id: Number(id) }, include: { lines: true, settlements: true, commission: true } });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      return fail(422, `Invoice berstatus ${invoice.status} tidak bisa di-settle.`);
    }

    const body = await req.json().catch(() => ({}));
    const amount = requireNum(body.amount, "amount", 1);
    const method = body.method === "TRANSFER" ? "TRANSFER" : "CASH";
    const reference = str(body.reference);

    const total = invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const settled = invoice.settlements.reduce((sum, s) => sum + s.amount, 0);
    const remaining = total - settled;
    if (amount > remaining + 0.01) {
      return fail(422, `Jumlah settlement (Rp${amount.toLocaleString("id-ID")}) melebihi sisa tagihan (Rp${remaining.toLocaleString("id-ID")}).`, {
        amount: ["Jumlah melebihi sisa tagihan."],
      });
    }

    const newSettled = settled + amount;
    const becomesFullyPaid = newSettled >= total - 0.01;
    const newStatus = becomesFullyPaid ? "SETTLED" : "PARTIALLY_SETTLED";

    // Atomic block: settlement row + invoice status + (on full payment) the
    // commission ledger credit — all-or-nothing (§30 B2B Commission).
    const { settlement, commissionReleased } = await db.$transaction(async (tx) => {
      const settlement = await tx.invoiceSettlement.create({
        data: { invoiceId: invoice.id, amount, method, reference, recordedById: user.id },
      });
      const updatedInvoice = await tx.invoice.update({ where: { id: invoice.id }, data: { status: newStatus } });
      void updatedInvoice;

      let commissionReleased = false;
      const commission = invoice.commission;
      if (becomesFullyPaid && commission && commission.status === "PENDING") {
        const freshCommission = await tx.marketingCommission.findUniqueOrThrow({ where: { id: commission.id } });
        if (freshCommission.status === "PENDING") {
          // Exactly-once release: unique businessRef COMM-{invoiceId}.
          const existing = await tx.walletTransaction.findUnique({ where: { businessRef: `COMM-${invoice.id}` } });
          if (!existing) {
            let wallet = await tx.wallet.findUnique({ where: { partnerId: freshCommission.partnerId } });
            if (!wallet) wallet = await tx.wallet.create({ data: { partnerId: freshCommission.partnerId } });
            const balanceBefore = wallet.balance;
            const balanceAfter = Math.round((balanceBefore + freshCommission.commissionAmount) * 100) / 100;
            const ledger = await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: "COMMISSION",
                amount: freshCommission.commissionAmount,
                direction: "CREDIT",
                balanceBefore,
                balanceAfter,
                referenceType: "commission",
                referenceId: freshCommission.id,
                businessRef: `COMM-${invoice.id}`,
                status: "COMPLETED",
                description: `Komisi B2B invoice ${invoice.invoiceNumber} (${freshCommission.partnerPercent}% dari Rp${freshCommission.invoiceAmount.toLocaleString("id-ID")})`,
                createdById: user.id,
              },
            });
            await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
            await tx.marketingCommission.update({
              where: { id: freshCommission.id },
              data: { status: "RELEASED", releasedAt: new Date(), walletTransactionId: ledger.id },
            });
          } else {
            await tx.marketingCommission.update({
              where: { id: freshCommission.id },
              data: { status: "RELEASED", releasedAt: new Date(), walletTransactionId: existing.id },
            });
          }
          commissionReleased = true;
        }
      }
      return { settlement, commissionReleased };
    });

    const updated = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    await audit({
      action: "settled", entityType: "invoice", entityId: invoice.id,
      entityLabel: `${invoice.invoiceNumber} · Rp${amount.toLocaleString("id-ID")}`, actor: user,
      after: { status: newStatus, commissionReleased },
    });
    return ok({ settlement, invoice: updated, commissionReleased });
  });
}
