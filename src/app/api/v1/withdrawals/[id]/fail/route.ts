import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/fail — bank transfer failed: the reserved
 * amount is released back to available and NO wallet debit ever happened.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.process");
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.status === "COMPLETED") return fail(422, "Withdrawal sudah selesai.");
    if (!["PENDING", "APPROVED", "PROCESSING"].includes(withdrawal.status)) {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa ditandai gagal.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Transfer bank gagal";
    const updated = await db.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: { status: "FAILED", rejectReason: reason },
      include: { partner: { include: { user: { select: { name: true } } } } },
    });
    await financeAudit(user, "failed", "withdrawal", withdrawal.id, withdrawal.requestCode, { reason });
    return ok(updated);
  });
}
