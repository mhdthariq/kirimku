import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";
import { hasPermission } from "@/lib/auth";
import { assertShipmentScope } from "@/lib/gudang-scope";
import { debitWallet, walletSummary } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * Submit a CREATED shipment for pickup.
 * Allowed for shipment editors, or for staff who may create pickup requests
 * (Admin Gudang requesting a pickup for a customer they know).
 * Gates (revision):
 * - the price MUST be counted first ("Hitung Harga") — a pickup request without
 *   a computed price is rejected (422);
 * - the Penerima (recipient) must be filled — it is printed on the Shipment
 *   Resi & every Detail Resi when the pickup is requested.
 *
 * B2C marketing escrow rule (Revise.md §6 extension):
 * - For B2C shipments attributed to a Marketing partner, requesting pickup
 *   debits the company's share (companyPercent × finalPriceAmount / 100) from
 *   the marketing wallet as an escrow hold. The wallet MUST have sufficient
 *   available balance (after withdrawal reservations) — otherwise the pickup
 *   request is rejected with 422.
 * - The escrow is refunded automatically if the shipment is later cancelled
 *   (see shipments/[id]/cancel/route.ts).
 * - B2B shipments are exempt: the company owns the B2B invoice and marketing
 *   never fronts money — commission is released only when the invoice is paid.
 * - Idempotent: businessRef `ESCROW-{masterId}` ensures a re-submit attempt
 *   after a partial failure does NOT double-debit.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.view");
    if (!hasPermission(user, "shipment.update") && !hasPermission(user, "pickup.create")) {
      return fail(403, "Missing permission: shipment.update");
    }
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: { details: true, customer: true },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!canTransition(master.status, "READY_FOR_PICKUP")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa di-submit untuk pickup.`);
    }
    if (master.details.length === 0) {
      return fail(422, "Tambahkan minimal satu detail barang sebelum submit untuk pickup.");
    }
    if (master.priceAmount == null || master.priceAmount <= 0) {
      return fail(422, "Harga belum dihitung - klik “Hitung Harga” dan simpan harga shipment sebelum submit untuk pickup.");
    }
    if (!master.penerimaName) {
      return fail(422, "Isi data Penerima (nama penerima) sebelum submit untuk pickup - Penerima dicetak pada resi.", {
        penerimaName: ["Penerima wajib diisi (dicetak pada Resi)."],
      });
    }

    // B2C marketing escrow hold — debit the company share from the marketing
    // wallet before the shipment can transition to READY_FOR_PICKUP.
    const isMarketingOwned =
      master.createdByPartnerId != null && (master.discountFundedBy === "MARKETING" || master.createdByPartnerId === user.partnerId);
    const isB2C = master.customer.type === "b2c";
    let escrowTxId: number | null = null;
    let escrowAmount = 0;
    if (isB2C && isMarketingOwned && master.createdByPartnerId != null) {
      const partner = await db.partner.findUnique({ where: { id: master.createdByPartnerId } });
      if (partner) {
        const finalPrice = master.finalPriceAmount ?? master.priceAmount;
        escrowAmount = Math.round((finalPrice * (partner.companyPercent / 100)) * 100) / 100;
        if (escrowAmount > 0) {
          // Pre-check (friendlier error than the raw debitWallet rejection)
          const summary = await walletSummary(partner.id);
          if (summary.available < escrowAmount - 0.001) {
            return fail(
              422,
              `Saldo wallet Marketing tidak mencukupi untuk request pickup shipment B2C ini. ` +
                `Diperlukan minimal Rp${Math.round(escrowAmount).toLocaleString("id-ID")} ` +
                `(${partner.companyPercent}% bagian company dari total Rp${Math.round(finalPrice).toLocaleString("id-ID")}). ` +
                `Saldo tersedia: Rp${summary.available.toLocaleString("id-ID")} ` +
                `(dari Rp${summary.balance.toLocaleString("id-ID")}, ` +
                `Rp${summary.reserved.toLocaleString("id-ID")} terreserve withdrawal aktif). ` +
                `Silakan top-up wallet terlebih dahulu.`,
              { wallet: ["Saldo wallet tidak mencukupi untuk escrow pickup."] },
            );
          }
          // Atomic debit. businessRef is unique — a duplicate attempt (e.g.
          // retry after a network blip) returns the existing ledger entry
          // instead of double-charging.
          const result = await debitWallet({
            partnerId: partner.id,
            type: "SHIPMENT_ESCROW",
            amount: escrowAmount,
            referenceType: "shipment",
            referenceId: master.id,
            businessRef: `ESCROW-${master.id}`,
            description: `Escrow hold - bagian company (${partner.companyPercent}%) untuk shipment B2C ${master.masterCode}`,
            createdById: user.id,
          });
          escrowTxId = result.transactionId;
        }
      }
    }

    const updated = await db.masterShipment.update({ where: { id: master.id }, data: { status: "READY_FOR_PICKUP" } });
    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "READY_FOR_PICKUP",
        description:
          escrowTxId != null
            ? `Shipment siap dijemput (${master.details.length} paket) - harga Rp${Math.round(master.priceAmount).toLocaleString("id-ID")}. Escrow Rp${Math.round(escrowAmount).toLocaleString("id-ID")} di-hold dari wallet Marketing.`
            : `Shipment siap dijemput (${master.details.length} paket) - harga Rp${Math.round(master.priceAmount).toLocaleString("id-ID")}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "status_change",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} → READY_FOR_PICKUP`,
      actor: user,
      after: escrowTxId != null ? { escrowAmount, escrowWalletTransactionId: escrowTxId } : undefined,
    });
    return ok(updated);
  });
}
