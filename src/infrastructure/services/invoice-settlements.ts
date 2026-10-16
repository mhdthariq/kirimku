import { randomUUID } from "crypto";
import { db } from "@/infrastructure/persistence/db";
import { HttpError } from "@/shared/http-error";

export interface SettlementInput {
  amount: number;
  pph: number;
  method: string;
  reference: string | null;
  proofUrl?: string | null;
  settledAt: Date;
}

/** Payments, invoice state and commission ledger change atomically. */
export async function mutateInvoiceSettlement(
  invoiceId: number,
  actorId: number,
  mutation: { type: "create"; input: SettlementInput } | { type: "update"; settlementId: number; input: SettlementInput } | { type: "delete"; settlementId: number },
) {
  try {
    return await db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true, settlements: true, commission: true } });
      if (!invoice) throw new HttpError(404, "Invoice tidak ditemukan.");
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") throw new HttpError(422, `Invoice berstatus ${invoice.status} tidak bisa di-settle.`);
      const previous = mutation.type === "create" ? null : invoice.settlements.find((s) => s.id === mutation.settlementId) ?? null;
      if (mutation.type !== "create" && !previous) throw new HttpError(404, "Settlement tidak ditemukan pada invoice ini.");
      const others = invoice.settlements.filter((s) => s.id !== previous?.id);
      const total = invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0) - invoice.discount + invoice.rounding;
      // PPh is an annotation within the transfer amount, never a deduction.
      const settled = others.reduce((sum, s) => sum + s.amount, 0) + (mutation.type === "delete" ? 0 : mutation.input.amount);
      if (mutation.type !== "delete" && settled > total + 0.01) throw new HttpError(422, "Pembayaran melebihi sisa tagihan.");
      const count = others.length + (mutation.type === "delete" ? 0 : 1);
      const fullyPaid = count > 0 && settled >= total - 0.01;
      const status = fullyPaid ? "SETTLED" : count > 0 ? "PARTIALLY_SETTLED" : "SENT";
      let settlement;
      if (mutation.type === "create") settlement = await tx.invoiceSettlement.create({ data: { ...mutation.input, invoiceId, recordedById: actorId } });
      else if (mutation.type === "update") settlement = await tx.invoiceSettlement.update({ where: { id: mutation.settlementId }, data: mutation.input });
      else await tx.invoiceSettlement.delete({ where: { id: mutation.settlementId } });
      const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
      const commission = invoice.commission;
      let commissionReleased = false;
      if (commission && ((fullyPaid && commission.status === "PENDING") || (!fullyPaid && commission.status === "RELEASED"))) {
        const releasing = fullyPaid;
        let wallet = await tx.wallet.findUnique({ where: { partnerId: commission.partnerId } });
        if (!wallet && releasing) wallet = await tx.wallet.create({ data: { partnerId: commission.partnerId } });
        if (!wallet) throw new HttpError(422, "Wallet komisi tidak ditemukan.");
        const balanceAfter = Math.round((wallet.balance + (releasing ? 1 : -1) * commission.commissionAmount) * 100) / 100;
        if (!releasing) {
          const reserved = await tx.withdrawalRequest.aggregate({ where: { partnerId: commission.partnerId, status: { in: ["PENDING", "APPROVED", "PROCESSING"] } }, _sum: { amount: true } });
          if (balanceAfter < (reserved._sum.amount ?? 0) - 0.001) throw new HttpError(422, "Komisi sudah digunakan atau dicadangkan untuk penarikan. Saldo tersedia tidak cukup untuk membatalkan pelunasan.");
        }
        const ledger = await tx.walletTransaction.create({ data: {
          walletId: wallet.id, type: releasing ? "COMMISSION" : "ADJUSTMENT",
          direction: releasing ? "CREDIT" : "DEBIT", amount: commission.commissionAmount,
          balanceBefore: wallet.balance, balanceAfter, referenceType: "commission", referenceId: commission.id,
          businessRef: `COMM-${invoiceId}-${releasing ? "RELEASE" : "REVERSAL"}-${randomUUID()}`,
          status: "COMPLETED", createdById: actorId,
          description: `${releasing ? "Komisi" : "Pembatalan komisi"} B2B invoice ${invoice.invoiceNumber}`,
        } });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        await tx.marketingCommission.update({ where: { id: commission.id }, data: {
          status: releasing ? "RELEASED" : "PENDING", releasedAt: releasing ? new Date() : null, walletTransactionId: releasing ? ledger.id : null,
        } });
        commissionReleased = releasing;
      }
      return { settlement, invoice: updated, commissionReleased, previous };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") throw new HttpError(409, "Invoice atau wallet berubah bersamaan. Muat ulang lalu coba lagi.");
    throw error;
  }
}
