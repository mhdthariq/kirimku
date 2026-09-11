import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/repairs/{id}/company-confirm — OWNER COMPANY party decision
 * (§21 second party, permission repair.approve).
 *
 * CONFIRM on an OWNER_CONFIRMED repair verifies it: REPAIR_VERIFIED + wallet
 * debit happen ATOMICALLY in one DB transaction (§30/§22) — a separate
 * REPAIR_DEDUCTION ledger entry; the original transport earnings are never
 * touched. The unique businessRef `REP-{repairId}` prevents double deduction.
 * CONFIRM on a PENDING repair is not allowed — the Vehicle Owner must
 * confirm first (two-party rule).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "repair.approve");
    const { id } = await params;
    const repair = await db.vehicleRepair.findUnique({ where: { id: Number(id) } });
    if (!repair) return fail(404, "Repair tidak ditemukan.");
    if (repair.status === "VERIFIED") return fail(422, "Repair sudah terverifikasi — wallet sudah didebit.");
    if (repair.status === "REJECTED") return fail(422, "Repair sudah ditolak.");
    if (repair.status !== "OWNER_CONFIRMED") {
      return fail(422, "Konfirmasi Vehicle Owner belum ada — dua pihak wajib konfirmasi berurutan (§21).");
    }

    const result = await db.$transaction(async (tx) => {
      const fresh = await tx.vehicleRepair.findUniqueOrThrow({ where: { id: repair.id } });
      if (fresh.status === "VERIFIED") return { repair: fresh, alreadyVerified: true as const };

      // Exactly-once REPAIR_DEDUCTION ledger entry (§9/§22).
      let ledgerId: number | null = fresh.walletTransactionId;
      const existing = await tx.walletTransaction.findUnique({ where: { businessRef: `REP-${fresh.id}` } });
      if (!existing) {
        let wallet = await tx.wallet.findUnique({ where: { partnerId: fresh.ownerId } });
        if (!wallet) wallet = await tx.wallet.create({ data: { partnerId: fresh.ownerId } });
        const balanceBefore = wallet.balance;
        const balanceAfter = Math.round((balanceBefore - fresh.amount) * 100) / 100;
        if (balanceAfter < -0.001) {
          throw new Error("Saldo wallet Vehicle Owner tidak mencukupi untuk deduction repair ini.");
        }
        const ledger = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REPAIR_DEDUCTION",
            amount: fresh.amount,
            direction: "DEBIT",
            balanceBefore,
            balanceAfter,
            referenceType: "repair",
            referenceId: fresh.id,
            businessRef: `REP-${fresh.id}`,
            status: "COMPLETED",
            description: `Deduction repair ${fresh.repairCode} — ${fresh.description}`,
            createdById: user.id,
          },
        });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        ledgerId = ledger.id;
      } else {
        ledgerId = existing.id;
      }

      await tx.repairConfirmation.create({
        data: { repairId: fresh.id, party: "OWNER_COMPANY", decision: "CONFIRMED", userId: user.id },
      });
      const updated = await tx.vehicleRepair.update({
        where: { id: fresh.id },
        data: { status: "VERIFIED", walletTransactionId: ledgerId, verifiedAt: new Date() },
      });
      return { repair: updated, alreadyVerified: false as const };
    });

    await financeAudit(user, "verified", "repair", repair.id, repair.repairCode, {
      amount: repair.amount,
      deductedFrom: "Vehicle Owner wallet",
    });
    return ok(result.repair);
  });
}
