import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/repairs/{id}/company-reject — OWNER COMPANY rejection
 * (permission repair.reject, §21): a rejected repair never debits the wallet.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "repair.reject");
    const { id } = await params;
    const repair = await db.vehicleRepair.findUnique({ where: { id: Number(id) } });
    if (!repair) return fail(404, "Repair tidak ditemukan.");
    if (repair.status === "VERIFIED") return fail(422, "Repair sudah terverifikasi — tidak bisa ditolak.");
    if (repair.status === "REJECTED") return fail(422, "Repair sudah ditolak.");

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason) ?? "Ditolak oleh Owner Company";

    const result = await db.$transaction(async (tx) => {
      await tx.repairConfirmation.create({
        data: { repairId: repair.id, party: "OWNER_COMPANY", decision: "REJECTED", note: reason, userId: user.id },
      });
      return tx.vehicleRepair.update({
        where: { id: repair.id },
        data: { status: "REJECTED", rejectReason: reason },
      });
    });
    await financeAudit(user, "rejected", "repair", repair.id, repair.repairCode, { by: "OWNER_COMPANY", reason });
    return ok(result);
  });
}
