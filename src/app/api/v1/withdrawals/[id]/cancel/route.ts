import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { requirePartner, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/cancel — partner cancels their OWN request
 * while it is still PENDING or APPROVED. Cancellation releases the
 * reservation; the wallet is never debited (§27).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.create");
    const partner = requirePartner(user);
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.partnerId !== partner.id) {
      return fail(403, "Akses ditolak — ini bukan permintaan withdrawal milik Anda.");
    }
    if (withdrawal.status === "COMPLETED") return fail(422, "Withdrawal yang sudah selesai tidak bisa diubah/dibatalkan (§24).");
    if (withdrawal.status === "PROCESSING") return fail(422, "Withdrawal sedang diproses transfer bank — hubungi Admin Kantor.");
    if (!["PENDING", "APPROVED"].includes(withdrawal.status)) {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa dibatalkan.`);
    }

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Dibatalkan oleh partner";
    const updated = await db.withdrawalRequest.update({
      where: { id: withdrawal.id },
      data: { status: "CANCELLED", rejectReason: reason },
    });
    await financeAudit(user, "cancelled", "withdrawal", withdrawal.id, withdrawal.requestCode, { reason });
    return ok(updated);
  });
}
