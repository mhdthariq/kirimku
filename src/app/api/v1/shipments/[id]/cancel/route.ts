import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";
import { assertShipmentScope } from "@/lib/gudang-scope";
import { creditWallet } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * Cancel a shipment. If the shipment is B2C + marketing-attributed and an
 * escrow hold was created when pickup was requested (see
 * shipments/[id]/ready/route.ts), the escrow amount is refunded to the
 * marketing wallet as a new SHIPMENT_ESCROW credit.
 *
 * Idempotent: the refund uses businessRef `ESCROW-REFUND-{masterId}`, so a
 * duplicate cancel attempt (impossible in practice since CANCELLED is a
 * terminal state, but defended anyway) does NOT double-credit.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.cancel");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: { customer: true },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!canTransition(master.status, "CANCELLED")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa dibatalkan.`);
    }

    // Look up the escrow hold (if any) for this shipment. Only B2C marketing
    // shipments carry an escrow; B2B and non-marketing shipments will have no
    // matching row and the refund step is skipped.
    const escrowHold = await db.walletTransaction.findUnique({
      where: { businessRef: `ESCROW-${master.id}` },
    });

    let refundTxId: number | null = null;
    let refundAmount = 0;

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.masterShipment.update({ where: { id: master.id }, data: { status: "CANCELLED" } });
      await tx.trackingEvent.create({
        data: {
          masterId: master.id,
          event: "CANCELLED",
          description:
            escrowHold != null
              ? `Shipment dibatalkan oleh ${user.name}. Escrow Rp${Math.round(escrowHold.amount).toLocaleString("id-ID")} dikembalikan ke wallet Marketing.`
              : `Shipment dibatalkan oleh ${user.name}`,
          actorId: user.id,
        },
      });
      return result;
    });

    // Refund the escrow OUTSIDE the shipment transaction — creditWallet runs
    // its own atomic ledger transaction. If this fails (e.g. race), the
    // shipment is still cancelled and the refund can be retried manually via
    // an ADJUSTMENT.
    if (escrowHold != null && master.createdByPartnerId != null) {
      refundAmount = escrowHold.amount;
      const refund = await creditWallet({
        partnerId: master.createdByPartnerId,
        type: "SHIPMENT_ESCROW",
        amount: refundAmount,
        referenceType: "shipment",
        referenceId: master.id,
        businessRef: `ESCROW-REFUND-${master.id}`,
        description: `Refund escrow - shipment ${master.masterCode} dibatalkan`,
        createdById: user.id,
      });
      refundTxId = refund.transactionId;
    }

    await audit({
      action: "status_change",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} → CANCELLED`,
      actor: user,
      after: refundTxId != null ? { escrowRefundAmount: refundAmount, escrowRefundWalletTransactionId: refundTxId } : undefined,
    });
    return ok(updated);
  });
}
