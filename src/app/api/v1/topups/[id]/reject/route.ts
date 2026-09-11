import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/reject — Owner Company rejects a top-up under
 * verification. No wallet change ever happens for rejected top-ups (§11).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.verify");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");
    if (topUp.status === "VERIFIED") return fail(422, "Top up sudah terverifikasi — tidak bisa ditolak.");
    if (!["PENDING_PAYMENT", "PENDING_VERIFICATION"].includes(topUp.status)) {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa ditolak.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Tidak memenuhi ketentuan";

    const updated = await db.topUpRequest.update({
      where: { id: topUp.id },
      data: { status: "REJECTED", rejectReason: reason },
    });
    await financeAudit(user, "rejected", "topup", topUp.id, topUp.requestCode, { reason });
    return ok(updated);
  });
}
