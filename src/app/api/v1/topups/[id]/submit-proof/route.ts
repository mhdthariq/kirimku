import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { requirePartner, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/submit-proof — Marketing submits their transfer
 * information / proof for the own top-up (§10.1 "Submit required information/
 * proof"). Only allowed while PENDING_PAYMENT.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.create");
    const partner = requirePartner(user, "MARKETING");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");
    if (topUp.partnerId !== partner.id) return fail(403, "Akses ditolak — ini bukan top up milik Anda.");

    const body = await req.json().catch(() => ({}));
    const note = str(body.note);
    const proofUrl = str(body.proofUrl);
    if (!note && !proofUrl) {
      return fail(422, "Sertakan keterangan transfer atau bukti transfer.", { note: ["Isi minimal satu."] });
    }
    if (topUp.status !== "PENDING_PAYMENT") {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa disubmit ulang.`);
    }

    const updated = await db.topUpRequest.update({
      where: { id: topUp.id },
      data: {
        partnerNote: note ?? topUp.partnerNote,
        partnerProofUrl: proofUrl ?? topUp.partnerProofUrl,
      },
    });
    await financeAudit(user, "updated", "topup", topUp.id, topUp.requestCode, { submittedInfo: true });
    return ok(updated);
  });
}
