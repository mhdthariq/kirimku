import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/reject — Owner Company rejects a withdrawal.
 * Rejection releases the reserved amount back to available (§27) — simply a
 * status change; the wallet was never debited.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.reject");
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa ditolak.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Tidak disetujui";

    const updated = await db.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: { status: "REJECTED", rejectReason: reason, reviewedById: user.id, reviewedAt: new Date() },
      include: { partner: { include: { user: { select: { name: true } } } } },
    });
    await financeAudit(user, "rejected", "withdrawal", withdrawal.id, withdrawal.requestCode, { reason });
    return ok(updated);
  });
}
