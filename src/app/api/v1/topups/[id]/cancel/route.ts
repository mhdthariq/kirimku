import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/cancel — Admin Kantor / Owner cancels a top-up
 * request that is still awaiting verification. Cancellation never touches
 * the wallet. Marketing has no cancel access (no Top Up menu for Marketing).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "wallet.topup.cancel");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");
    if (topUp.status === "VERIFIED") return fail(422, "Top up sudah terverifikasi - tidak bisa dibatalkan.");
    if (topUp.status !== "PENDING_VERIFICATION") {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa dibatalkan.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) || "Dibatalkan oleh Admin Kantor";
    const updated = await db.topUpRequest.update({
      where: { id: topUp.id },
      data: { status: "CANCELLED", rejectReason: reason },
    });
    await financeAudit(user, "cancelled", "topup", topUp.id, topUp.requestCode, { reason });
    return ok(updated);
  });
}
