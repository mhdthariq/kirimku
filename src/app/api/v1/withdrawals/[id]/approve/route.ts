import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/approve — Owner Company approves a PENDING
 * request (§26). The reservation stays active until completion.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.approve");
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.status !== "PENDING") {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa disetujui.`);
    }

    const updated = await db.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() },
      include: { partner: { include: { user: { select: { name: true } } } } },
    });
    await financeAudit(user, "approved", "withdrawal", withdrawal.id, withdrawal.requestCode, { amount: withdrawal.amount });
    return ok(updated);
  });
}
