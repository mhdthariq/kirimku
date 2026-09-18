import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, requireNum, str, num, dateOrNull } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";
import { appendRepairLedger, logRepairAction } from "@/lib/repair-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/repairs/{id} — edit a repair record (repair.update).
 *
 * Corrections are allowed for authorized users; the Vehicle Owner is informed
 * through the per-item action log (UPDATED entry with a field-level diff).
 * If the amount changes, the wallet is adjusted atomically in the same
 * transaction: increase → extra REPAIR_DEDUCTION debit, decrease → partial
 * refund CREDIT. The ledger stays append-only / immutable (§29).
 */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "repair.update");
    const { id } = await params;
    const repair = await db.vehicleRepair.findUnique({
      where: { id: Number(id) },
      include: { vehicle: { select: { id: true, vehicleNumber: true } } },
    });
    if (!repair) return fail(404, "Repair tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const description = requireStr(body.description, "description");
    const amount = requireNum(body.amount, "amount", 1);
    const repairDate = dateOrNull(body.repairDate) ?? repair.repairDate;
    const workshopVendor = str(body.workshopVendor);
    const proofUrl = str(body.proofUrl) ?? repair.proofUrl;
    const notes = str(body.notes);
    const relatedTransportId = num(body.relatedTransportId);

    if (!proofUrl) {
      return fail(422, "Bukti repair (invoice/nota/foto) wajib dilampirkan.", { proofUrl: ["Bukti wajib dilampirkan."] });
    }
    if (relatedTransportId) {
      const transport = await db.transport.findUnique({ where: { id: relatedTransportId } });
      if (!transport || transport.vehicleId !== repair.vehicleId) {
        return fail(422, "Transport terkait tidak cocok dengan kendaraan repair ini.", { relatedTransportId: ["Transport tidak cocok."] });
      }
    }

    // Field-level diff for the action log (owner-visible "what changed").
    const before = {
      description: repair.description,
      amount: repair.amount,
      repairDate: repair.repairDate.toISOString().slice(0, 10),
      workshopVendor: repair.workshopVendor ?? "",
      proofUrl: repair.proofUrl ?? "",
      notes: repair.notes ?? "",
      relatedTransportId: repair.relatedTransportId ?? null,
    };
    const after = {
      description,
      amount,
      repairDate: repairDate.toISOString().slice(0, 10),
      workshopVendor: workshopVendor ?? "",
      proofUrl: proofUrl ?? "",
      notes: notes ?? "",
      relatedTransportId: relatedTransportId ?? null,
    };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key as keyof typeof before]) !== JSON.stringify(after[key as keyof typeof after])) {
        changes[key] = { before: before[key as keyof typeof before], after: after[key as keyof typeof after] };
      }
    }
    if (Object.keys(changes).length === 0) {
      return fail(422, "Tidak ada perubahan yang terdeteksi — tidak ada yang perlu disimpan.");
    }

    const amountDelta = Math.round((amount - repair.amount) * 100) / 100;

    const updated = await db.$transaction(async (tx) => {
      let deductedAmount = repair.deductedAmount;

      // Wallet adjustment when the amount changes — append-only ledger rows.
      if (amountDelta > 0) {
        await appendRepairLedger(tx, {
          partnerId: repair.ownerId,
          direction: "DEBIT",
          amount: amountDelta,
          businessRef: `REP-ADJ-${repair.id}-${Date.now()}`,
          description: `Tambahan deduction repair ${repair.repairCode} (biaya diubah ${formatIDR(repair.amount)} → ${formatIDR(amount)})`,
          repairId: repair.id,
          createdById: user.id,
        });
        deductedAmount = Math.round((deductedAmount + amountDelta) * 100) / 100;
      } else if (amountDelta < 0) {
        await appendRepairLedger(tx, {
          partnerId: repair.ownerId,
          direction: "CREDIT",
          amount: -amountDelta,
          businessRef: `REP-ADJ-${repair.id}-${Date.now()}`,
          description: `Pengembalian sebagian deduction repair ${repair.repairCode} (biaya diubah ${formatIDR(repair.amount)} → ${formatIDR(amount)})`,
          repairId: repair.id,
          createdById: user.id,
        });
        deductedAmount = Math.round((deductedAmount + amountDelta) * 100) / 100;
      }

      const row = await tx.vehicleRepair.update({
        where: { id: repair.id },
        data: {
          description,
          amount,
          repairDate,
          workshopVendor,
          proofUrl,
          notes,
          relatedTransportId,
          deductedAmount,
        },
        include: { vehicle: { select: { vehicleNumber: true } }, owner: { include: { user: { select: { name: true } } } } },
      });

      const changedSummary = Object.keys(changes)
        .filter((k) => k !== "proofUrl")
        .join(", ");
      await logRepairAction(tx, {
        repairId: repair.id,
        repairCode: repair.repairCode,
        ownerId: repair.ownerId,
        vehicleNumber: repair.vehicle.vehicleNumber,
        action: "UPDATED",
        detail: `Repair ${repair.repairCode} diubah oleh ${user.name}${changedSummary ? ` — field: ${changedSummary}` : ""}${amountDelta !== 0 ? ` · wallet disesuaikan ${amountDelta > 0 ? "+" : ""}${formatIDR(amountDelta)}` : ""}.`,
        changes,
        amount,
        actor: user,
      });

      return row;
    });

    await financeAudit(user, "updated", "repair", repair.id, repair.repairCode, {
      changes,
      walletAdjustment: amountDelta,
    });
    return ok(updated);
  });
}

/**
 * DELETE /api/v1/repairs/{id} — remove a wrong repair record (repair.delete).
 *
 * The net deducted amount is REFUNDED to the Vehicle Owner wallet first
 * (append-only CREDIT ledger row), then the repair row is deleted — all in
 * one atomic transaction. A DELETED action-log entry (with snapshots:
 * repair code, vehicle, amount, description) is kept so the Vehicle Owner
 * can always see that the record existed and was removed, by whom, and when.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "repair.delete");
    const { id } = await params;
    const repair = await db.vehicleRepair.findUnique({
      where: { id: Number(id) },
      include: { vehicle: { select: { vehicleNumber: true } } },
    });
    if (!repair) return fail(404, "Repair tidak ditemukan.");

    await db.$transaction(async (tx) => {
      // Refund whatever was actually deducted from the owner wallet.
      if (repair.deductedAmount > 0) {
        await appendRepairLedger(tx, {
          partnerId: repair.ownerId,
          direction: "CREDIT",
          amount: repair.deductedAmount,
          businessRef: `REP-DEL-${repair.id}-${Date.now()}`,
          description: `Pengembalian penuh deduction repair ${repair.repairCode} (${formatIDR(repair.deductedAmount)}) — record dihapus.`,
          repairId: repair.id,
          createdById: user.id,
        });
      }

      // Snapshot log FIRST (survives the delete — plain-int repairId).
      await logRepairAction(tx, {
        repairId: repair.id,
        repairCode: repair.repairCode,
        ownerId: repair.ownerId,
        vehicleNumber: repair.vehicle.vehicleNumber,
        action: "DELETED",
        detail: `Repair ${repair.repairCode} (${repair.description} — ${formatIDR(repair.amount)}) dihapus oleh ${user.name}${repair.deductedAmount > 0 ? ` · deduction ${formatIDR(repair.deductedAmount)} dikembalikan ke wallet` : ""}.`,
        amount: repair.amount,
        actor: user,
      });

      await tx.vehicleRepair.delete({ where: { id: repair.id } });
    });

    await financeAudit(user, "deleted", "repair", repair.id, repair.repairCode, {
      vehicle: repair.vehicle.vehicleNumber,
      amount: repair.amount,
      refunded: repair.deductedAmount,
    });
    return ok({ id: repair.id, deleted: true });
  });
}

function formatIDR(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}
