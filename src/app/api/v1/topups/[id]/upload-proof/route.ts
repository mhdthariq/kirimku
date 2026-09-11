import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/upload-proof — Admin Kantor uploads the official
 * transfer proof and submits the request for Owner verification (§10.1):
 * PENDING_PAYMENT → PENDING_VERIFICATION.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.proof.upload");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const proofUrl = str(body.proofUrl);
    if (!proofUrl) return fail(422, "Bukti transfer wajib diunggah.", { proofUrl: ["Bukti wajib diunggah."] });
    if (topUp.status !== "PENDING_PAYMENT") {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa diproses.`);
    }

    const updated = await db.topUpRequest.update({
      where: { id: topUp.id },
      data: {
        proofUrl,
        status: "PENDING_VERIFICATION",
        submittedForVerificationAt: new Date(),
      },
    });
    await financeAudit(user, "status_change", "topup", topUp.id, topUp.requestCode, { status: "PENDING_VERIFICATION" });
    return ok(updated);
  });
}
