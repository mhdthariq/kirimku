import { NextRequest } from "next/server";
import { guard, ok, handle, fail, requireNum, str, bool } from "@/lib/api-helpers";
import { requirePartner, creditWallet, debitWallet, walletSummary, financeAudit } from "@/lib/wallet";
import { db } from "@/lib/db";

/**
 * POST /api/v1/wallet/adjustments — Owner Company correction entry (§29).
 * Completed financial transactions are immutable; corrections are new
 * ADJUSTMENT ledger rows, authorized only by wallet.adjustment.create.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.adjustment.create");
    const body = await req.json().catch(() => ({}));
    const partnerId = requireNum(body.partnerId, "partnerId", 1);
    const amount = requireNum(body.amount, "amount", 1);
    const direction = body.direction === "DEBIT" ? "DEBIT" : "CREDIT";
    const reason = str(body.reason);
    if (!reason) return fail(422, "Alasan penyesuaian wajib diisi.", { reason: ["Alasan wajib diisi."] });

    const partner = await db.partner.findUnique({ where: { id: partnerId } });
    if (!partner) return fail(404, "Partner tidak ditemukan.");

    const businessRef = `ADJ-P${partnerId}-${Date.now()}`;
    const result =
      direction === "CREDIT"
        ? await creditWallet({
            partnerId,
            type: "ADJUSTMENT",
            amount,
            referenceType: "adjustment",
            referenceId: null,
            businessRef,
            description: `Penyesuaian (kredit) oleh Owner: ${reason}`,
            createdById: user.id,
          })
        : await debitWallet(
            {
              partnerId,
              type: "ADJUSTMENT",
              amount,
              referenceType: "adjustment",
              referenceId: null,
              businessRef,
              description: `Penyesuaian (debit) oleh Owner: ${reason}`,
              createdById: user.id,
            },
            { respectReservation: bool(body.respectReservation, false) },
          );

    await financeAudit(user, "created", "wallet_adjustment", result.transactionId, businessRef, {
      partnerId,
      amount,
      direction,
      reason,
    });
    const summary = await walletSummary(partnerId);
    return ok({ ...result, wallet: summary });
  });
}
