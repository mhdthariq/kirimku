import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { requirePartner, debitWallet, financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/repairs/{id}/confirm — VEHICLE OWNER party decision (§21).
 * decision=CONFIRM (default) advances PENDING_CONFIRMATION → OWNER_CONFIRMED;
 * decision=REJECT rejects the repair outright. Either way the wallet is only
 * ever touched when the SECOND party (Owner Company) also confirms.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "repair.confirm");
    const partner = requirePartner(user, "VEHICLE_OWNER");
    const { id } = await params;
    const repair = await db.vehicleRepair.findUnique({
      where: { id: Number(id) },
      include: { vehicle: { select: { vehicleNumber: true } } },
    });
    if (!repair) return fail(404, "Repair tidak ditemukan.");
    if (repair.ownerId !== partner.id) return fail(403, "Akses ditolak — ini bukan repair kendaraan milik Anda.");
    if (repair.status === "VERIFIED") return fail(422, "Repair sudah terverifikasi dan terdeduct.");
    if (repair.status === "REJECTED") return fail(422, "Repair sudah ditolak.");

    const body = await req.json().catch(() => ({}));
    const decision = body.decision === "REJECT" ? "REJECTED" : "CONFIRMED";
    const note = str(body.note);

    if (decision === "REJECTED") {
      const result = await db.$transaction(async (tx) => {
        await tx.repairConfirmation.create({
          data: { repairId: repair.id, party: "VEHICLE_OWNER", decision: "REJECTED", note, userId: user.id },
        });
        return tx.vehicleRepair.update({
          where: { id: repair.id },
          data: { status: "REJECTED", rejectReason: note ?? "Ditolak oleh Vehicle Owner" },
        });
      });
      await financeAudit(user, "rejected", "repair", repair.id, repair.repairCode, { by: "VEHICLE_OWNER" });
      return ok(result);
    }

    if (repair.status !== "PENDING_CONFIRMATION") {
      return fail(422, `Repair berstatus ${repair.status} — konfirmasi Vehicle Owner sudah ada.`);
    }

    const result = await db.$transaction(async (tx) => {
      await tx.repairConfirmation.create({
        data: { repairId: repair.id, party: "VEHICLE_OWNER", decision: "CONFIRMED", note, userId: user.id },
      });
      return tx.vehicleRepair.update({ where: { id: repair.id }, data: { status: "OWNER_CONFIRMED" } });
    });
    await financeAudit(user, "confirmed", "repair", repair.id, repair.repairCode, { by: "VEHICLE_OWNER" });
    return ok(result);
  });
}
