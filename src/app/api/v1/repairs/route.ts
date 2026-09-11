import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, requireNum, str, num, dateOrNull } from "@/lib/api-helpers";
import { requirePartner, financeAudit } from "@/lib/wallet";
import { nextCode } from "@/lib/code-generator";

/**
 * Repair / maintenance deduction records (§19/§20):
 *   - Company (repair.create) submits a repair cost for a partner-owned
 *     vehicle with proof. Status starts at PENDING_CONFIRMATION and the
 *     Vehicle Owner wallet is NOT touched yet.
 *   - Vehicle Owner (repair.view_own) sees only their own-vehicle repairs.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    // Vehicle Owner: own repairs only (§39).
    if (user.partnerType === "VEHICLE_OWNER" && user.partnerId) {
      const rows = await db.vehicleRepair.findMany({
        where: { ownerId: user.partnerId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { id: true, vehicleNumber: true, name: true } },
          confirmations: { include: { user: { select: { name: true } } } },
        },
      });
      return ok(rows);
    }

    // Company view.
    if (!user.isOwner && !user.permissions.includes("repair.view")) {
      return fail(403, "Missing permission: repair.view");
    }
    const rows = await db.vehicleRepair.findMany({
      where: { ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        vehicle: { select: { id: true, vehicleNumber: true, name: true } },
        owner: { include: { user: { select: { name: true } } } },
        confirmations: { include: { user: { select: { name: true } } } },
      },
    });
    return ok(rows);
  });
}

/**
 * POST /api/v1/repairs — company submits a repair record. The wallet is NOT
 * debited at creation (§20) — the deduction only happens after BOTH the
 * Vehicle Owner and Owner Company confirm (§21).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "repair.create");
    const body = await req.json().catch(() => ({}));
    const vehicleId = requireNum(body.vehicleId, "vehicleId", 1);
    const description = requireStr(body.description, "description");
    const amount = requireNum(body.amount, "amount", 1);
    const repairDate = dateOrNull(body.repairDate) ?? new Date();
    const workshopVendor = str(body.workshopVendor);
    const proofUrl = str(body.proofUrl);
    const notes = str(body.notes);
    const relatedTransportId = num(body.relatedTransportId);

    if (!proofUrl) {
      return fail(422, "Bukti repair (invoice/nota/foto) wajib diunggah (§19).", { proofUrl: ["Bukti wajib diunggah."] });
    }

    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId }, include: { owner: true } });
    if (!vehicle) return fail(404, "Kendaraan tidak ditemukan.");
    if (!vehicle.owner) {
      return fail(422, "Kendaraan ini milik perusahaan — tidak ada Vehicle Owner yang bisa dibebani repair.");
    }
    if (relatedTransportId) {
      const transport = await db.transport.findUnique({ where: { id: relatedTransportId } });
      if (!transport || transport.vehicleId !== vehicleId) {
        return fail(422, "Transport terkait tidak cocok dengan kendaraan yang dipilih.", { relatedTransportId: ["Transport tidak cocok."] });
      }
    }

    const repairCode = await nextCode("vehicleRepair", "REP-", "repairCode");
    const repair = await db.vehicleRepair.create({
      data: {
        repairCode,
        vehicleId,
        ownerId: vehicle.owner.id,
        description,
        amount,
        repairDate,
        workshopVendor,
        proofUrl,
        relatedTransportId,
        notes,
        status: "PENDING_CONFIRMATION",
        createdById: user.id,
      },
      include: { vehicle: { select: { vehicleNumber: true } }, owner: { include: { user: { select: { name: true } } } } },
    });
    await financeAudit(user, "created", "repair", repair.id, repairCode, {
      vehicle: vehicle.vehicleNumber,
      amount,
      status: "PENDING_CONFIRMATION",
    });
    return ok(repair);
  });
}
