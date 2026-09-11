import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/process — Admin Kantor / Owner Company marks
 * an APPROVED withdrawal as in-flight bank transfer (PROCESSING), optionally
 * attaching the transfer proof (wallet.withdrawal.proof.upload).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.process");
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.status !== "APPROVED") {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa diproses — harus APPROVED.`);
    }

    const body = await req.json().catch(() => ({}));
    const proofUrl = str(body.proofUrl);

    const updated = await db.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: {
        status: "PROCESSING",
        processedById: user.id,
        processedAt: new Date(),
        ...(proofUrl ? { transferProofUrl: proofUrl } : {}),
      },
      include: { partner: { include: { user: { select: { name: true } } } } },
    });
    await financeAudit(user, "status_change", "withdrawal", withdrawal.id, withdrawal.requestCode, { status: "PROCESSING" });
    return ok(updated);
  });
}
