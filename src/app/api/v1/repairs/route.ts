import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, requireNum, str, num, dateOrNull } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";
import { appendRepairLedger, logRepairAction } from "@/lib/repair-helpers";
import { nextCode } from "@/lib/code-generator";

/**
 * Repair / maintenance deduction records (§19/§20, simplified flow):
 *   - Company (repair.create) submits a repair cost for a partner-owned
 *     vehicle with proof. The record is VERIFIED immediately — no approval
 *     workflow — and the REPAIR_DEDUCTION is debited from the Vehicle Owner
 *     wallet atomically in the same DB transaction.
 *   - Every mutation writes a RepairActionLog entry (CREATED / UPDATED /
 *     DELETED) so the Vehicle Owner can audit the full history.
 *   - Vehicle Owner (repair.view_own) sees only their own-vehicle repairs
 *     (list + detail + logs) — read-only.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    // Vehicle Owner: own repairs only (§39) — read-only view.
    if (user.partnerType === "VEHICLE_OWNER" && user.partnerId) {
      const rows = await db.vehicleRepair.findMany({
        where: { ownerId: user.partnerId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { id: true, vehicleNumber: true, name: true } },
          owner: { include: { user: { select: { name: true } } } },
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
      },
    });
    return ok(rows);
  });
}

/**
 * POST /api/v1/repairs — company creates a repair record. Authorized users
 * (repair.create) create FINAL records: status VERIFIED + wallet deduction
 * happen atomically at creation. A RepairActionLog entry (CREATED) is
 * written in the same transaction so the Vehicle Owner always knows who
 * created what and when.
 */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
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
      return fail(422, "Kendaraan ini milik perusahaan - tidak ada Vehicle Owner yang bisa dibebani repair.");
    }
    if (relatedTransportId) {
      const transport = await db.transport.findUnique({ where: { id: relatedTransportId } });
      if (!transport || transport.vehicleId !== vehicleId) {
        return fail(422, "Transport terkait tidak cocok dengan kendaraan yang dipilih.", { relatedTransportId: ["Transport tidak cocok."] });
      }
    }

    const repairCode = await nextCode("vehicleRepair", "REP-", "repairCode");

    // One atomic transaction: repair row (VERIFIED) + REPAIR_DEDUCTION
    // ledger + balance update + action log — all or nothing (§30).
    const repair = await db.$transaction(async (tx) => {
      const created = await tx.vehicleRepair.create({
        data: {
          repairCode,
          vehicleId,
          ownerId: vehicle.owner!.id,
          description,
          amount,
          repairDate,
          workshopVendor,
          proofUrl,
          relatedTransportId,
          notes,
          status: "VERIFIED",
          createdById: user.id,
        },
      });

      const ledgerId = await appendRepairLedger(tx, {
        partnerId: created.ownerId,
        direction: "DEBIT",
        amount,
        businessRef: `REP-${created.id}`,
        description: `Deduction repair ${repairCode} - ${description}`,
        repairId: created.id,
        createdById: user.id,
      });

      const withLedger = await tx.vehicleRepair.update({
        where: { id: created.id },
        data: { walletTransactionId: ledgerId, deductedAmount: amount, verifiedAt: new Date() },
        include: { vehicle: { select: { vehicleNumber: true } }, owner: { include: { user: { select: { name: true } } } } },
      });

      await logRepairAction(tx, {
        repairId: created.id,
        repairCode,
        ownerId: created.ownerId,
        vehicleNumber: vehicle.vehicleNumber,
        action: "CREATED",
        detail: `Repair ${repairCode} dibuat dan langsung terverifikasi - deduction ${formatIDR(amount)} dari wallet Vehicle Owner.`,
        amount,
        actor: user,
      });

      return withLedger;
    });

    await financeAudit(user, "created", "repair", repair.id, repairCode, {
      vehicle: vehicle.vehicleNumber,
      amount,
      status: "VERIFIED",
      immediatelyDeducted: true,
    });
    return ok(repair);
  });
}

function formatIDR(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}
