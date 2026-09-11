import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { requirePartner, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/cancel — Marketing cancels their OWN top-up
 * request before it is verified. Cancellation never touches the wallet.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.create");
    const partner = requirePartner(user, "MARKETING");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");
    if (topUp.partnerId !== partner.id) return fail(403, "Akses ditolak — ini bukan top up milik Anda.");
    if (topUp.status === "VERIFIED") return fail(422, "Top up sudah terverifikasi — tidak bisa dibatalkan.");
    if (!["PENDING_PAYMENT", "PENDING_VERIFICATION"].includes(topUp.status)) {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa dibatalkan.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Dibatalkan oleh partner";
    const updated = await db.topUpRequest.update({
      where: { id: topUp.id },
      data: { status: "CANCELLED", rejectReason: reason },
    });
    await financeAudit(user, "cancelled", "topup", topUp.id, topUp.requestCode, { reason });
    return ok(updated);
  });
}
