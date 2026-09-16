import { db } from "@/lib/db";
import { HttpError } from "@/lib/api-helpers";
import type { AuthUser } from "@/lib/auth";

/**
 * Repair helpers — simplified repair flow:
 *   · create  = immediately VERIFIED + REPAIR_DEDUCTION debited atomically
 *   · update  = wallet auto-adjusted (extra debit / partial refund) + log
 *   · delete  = full refund of the net deducted amount + log
 *
 * Every mutation appends a RepairActionLog row (append-only) so the Vehicle
 * Owner can audit the full history of each record — including records that
 * were later deleted (the log keeps snapshots, `repairId` is a plain int
 * with no FK so log rows survive deletion).
 */

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Append a wallet ledger row + update the balance, INSIDE a caller-owned
 * Prisma transaction (same pattern as the settlement engine). Debits may
 * never push the balance negative.
 */
export async function appendRepairLedger(
  tx: Tx,
  input: {
    partnerId: number;
    direction: "CREDIT" | "DEBIT";
    amount: number;
    businessRef: string;
    description: string;
    type?: "REPAIR_DEDUCTION" | "ADJUSTMENT";
    repairId: number;
    createdById?: number | null;
  },
): Promise<number> {
  let wallet = await tx.wallet.findUnique({ where: { partnerId: input.partnerId } });
  if (!wallet) wallet = await tx.wallet.create({ data: { partnerId: input.partnerId } });

  // Exactly-once guard — an existing row with the same businessRef means the
  // adjustment was already applied (retry / double click).
  const existing = await tx.walletTransaction.findUnique({ where: { businessRef: input.businessRef } });
  if (existing) return existing.id;

  const amount = round2(input.amount);
  if (amount <= 0) throw new HttpError(422, "Jumlah harus lebih besar dari nol.");

  const balanceBefore = wallet.balance;
  const balanceAfter =
    input.direction === "CREDIT" ? round2(balanceBefore + amount) : round2(balanceBefore - amount);

  if (balanceAfter < -0.001) {
    throw new HttpError(
      422,
      "Saldo wallet Vehicle Owner tidak mencukupi untuk deduction repair ini. " +
        "Minta top-up / tunggu profit share transport berikutnya sebelum mencatat repair.",
    );
  }

  const ledger = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: input.type ?? "REPAIR_DEDUCTION",
      amount,
      direction: input.direction,
      balanceBefore,
      balanceAfter,
      referenceType: "repair",
      referenceId: input.repairId,
      businessRef: input.businessRef,
      status: "COMPLETED",
      description: input.description,
      createdById: input.createdById ?? null,
    },
  });
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
  return ledger.id;
}

/** Append a RepairActionLog row (append-only, never blocks the main flow). */
export async function logRepairAction(
  tx: Tx,
  input: {
    repairId: number;
    repairCode: string;
    ownerId: number;
    vehicleNumber: string;
    action: "CREATED" | "UPDATED" | "DELETED";
    detail: string;
    changes?: Record<string, { before: unknown; after: unknown }> | null;
    amount?: number | null;
    actor?: AuthUser | null;
  },
): Promise<void> {
  await tx.repairActionLog.create({
    data: {
      repairId: input.repairId,
      repairCode: input.repairCode,
      ownerId: input.ownerId,
      vehicleNumber: input.vehicleNumber,
      action: input.action,
      detail: input.detail,
      changes: input.changes ? JSON.stringify(input.changes) : null,
      amount: input.amount ?? null,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
    },
  });
}
