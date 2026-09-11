import { db } from "@/lib/db";
import { HttpError } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import type { AuthUser } from "@/lib/auth";

/**
 * Wallet ledger engine — Revise.md "Partner Wallet, B2B & Vehicle Owner
 * Financial Rules".
 *
 * Guarantees enforced here (§9, §28, §29, §30):
 *  - Ledger-based: every balance change creates a WalletTransaction row with
 *    balanceBefore/balanceAfter. No ad-hoc `wallet.balance = x` updates.
 *  - Atomic: credit/debit run inside a single Prisma interactive transaction
 *    that updates the wallet row and appends the ledger entry together.
 *  - Exactly-once: every operation carries a unique `businessRef`; duplicate
 *    attempts (double clicks, retried callbacks) are rejected/ignored by the
 *    DB unique constraint instead of double-crediting.
 *  - Immutable: completed transactions are never edited or deleted —
 *    corrections are new ADJUSTMENT rows.
 */

export type WalletTxType =
  | "TOPUP"
  | "COMMISSION"
  | "TRANSPORT_PROFIT_SHARE"
  | "REPAIR_DEDUCTION"
  | "WITHDRAWAL"
  | "ADJUSTMENT";

export const PARTNER_TYPES = ["MARKETING", "VEHICLE_OWNER"] as const;

/** Withdrawal statuses that reserve funds (§27). */
export const RESERVING_WITHDRAWAL_STATUSES = ["PENDING", "APPROVED", "PROCESSING"];

export interface LedgerInput {
  partnerId: number;
  type: WalletTxType;
  amount: number;
  referenceType?: string | null;
  referenceId?: number | null;
  /** unique business reference — duplicate protection (§9) */
  businessRef: string;
  description?: string | null;
  createdById?: number | null;
}

export interface LedgerResult {
  transactionId: number;
  balanceBefore: number;
  balanceAfter: number;
}

/** Get (or lazily create) the partner's wallet row. */
export async function getOrCreateWallet(partnerId: number): Promise<{ id: number; balance: number }> {
  const existing = await db.wallet.findUnique({ where: { partnerId } });
  if (existing) return { id: existing.id, balance: existing.balance };
  const partner = await db.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw new HttpError(404, "Partner tidak ditemukan.");
  const created = await db.wallet.create({ data: { partnerId } });
  return { id: created.id, balance: 0 };
}

/**
 * Sum of amounts currently reserved by in-flight withdrawals
 * (PENDING / APPROVED / PROCESSING — §27).
 */
export async function reservedAmount(partnerId: number): Promise<number> {
  const rows = await db.withdrawalRequest.aggregate({
    where: { partnerId, status: { in: RESERVING_WITHDRAWAL_STATUSES } },
    _sum: { amount: true },
  });
  return rows._sum.amount ?? 0;
}

export interface WalletSummary {
  partnerId: number;
  walletId: number;
  balance: number;
  reserved: number;
  available: number;
}

/** Balance / reservation / available summary (§27). */
export async function walletSummary(partnerId: number): Promise<WalletSummary> {
  const wallet = await getOrCreateWallet(partnerId);
  const reserved = await reservedAmount(partnerId);
  return {
    partnerId,
    walletId: wallet.id,
    balance: wallet.balance,
    reserved,
    available: Math.max(0, wallet.balance - reserved),
  };
}

async function appendLedger(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  input: LedgerInput,
  direction: "CREDIT" | "DEBIT",
): Promise<LedgerResult> {
  const wallet = await tx.wallet.findUnique({ where: { partnerId: input.partnerId } });
  if (!wallet) throw new HttpError(404, "Wallet partner tidak ditemukan.");

  // Exactly-once guard: an existing ledger row with the same businessRef means
  // this settlement was already applied (duplicate callback / retry).
  const existing = await tx.walletTransaction.findUnique({ where: { businessRef: input.businessRef } });
  if (existing) {
    return { transactionId: existing.id, balanceBefore: existing.balanceBefore, balanceAfter: existing.balanceAfter };
  }

  const balanceBefore = wallet.balance;
  const balanceAfter =
    direction === "CREDIT" ? round2(balanceBefore + input.amount) : round2(balanceBefore - input.amount);

  if (balanceAfter < -0.001) {
    throw new HttpError(422, "Saldo wallet tidak mencukupi untuk operasi debit ini.");
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: input.type,
      amount: round2(input.amount),
      direction,
      balanceBefore,
      balanceAfter,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      businessRef: input.businessRef,
      status: "COMPLETED",
      description: input.description ?? null,
      createdById: input.createdById ?? null,
    },
  });
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
  return { transactionId: transaction.id, balanceBefore, balanceAfter };
}

/**
 * Atomically CREDIT the partner wallet: ledger row + balance update in one
 * DB transaction (§30). Duplicate businessRef → returns the existing entry
 * (no double credit).
 */
export async function creditWallet(input: LedgerInput): Promise<LedgerResult> {
  await getOrCreateWallet(input.partnerId);
  return db.$transaction(async (tx) => appendLedger(tx, input, "CREDIT"));
}

/**
 * Atomically DEBIT the partner wallet. Validates the remaining balance stays
 * non-negative AND (optionally) that in-flight withdrawal reservations remain
 * covered, so a debit can never create a negative available balance (§44).
 */
export async function debitWallet(
  input: LedgerInput,
  opts: { respectReservation?: boolean } = {},
): Promise<LedgerResult> {
  await getOrCreateWallet(input.partnerId);
  return db.$transaction(async (tx) => {
    if (opts.respectReservation) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { partnerId: input.partnerId } });
      const reservedRows = await tx.withdrawalRequest.aggregate({
        where: { partnerId: input.partnerId, status: { in: RESERVING_WITHDRAWAL_STATUSES } },
        _sum: { amount: true },
      });
      const reserved = reservedRows._sum.amount ?? 0;
      if (round2(wallet.balance - reserved - input.amount) < -0.001) {
        throw new HttpError(
          422,
          "Saldo tersedia tidak mencukupi (sebagian saldo sedang direserve oleh permintaan withdrawal aktif).",
        );
      }
    }
    return appendLedger(tx, input, "DEBIT");
  });
}

/**
 * Release a partner's funds check helper — is `amount` within the available
 * (non-reserved) balance? Used when creating withdrawals (§27).
 */
export async function assertAvailableBalance(partnerId: number, amount: number): Promise<WalletSummary> {
  const summary = await walletSummary(partnerId);
  if (amount <= 0) throw new HttpError(422, "Jumlah harus lebih besar dari nol.");
  if (round2(summary.available - amount) < -0.001) {
    throw new HttpError(
      422,
      `Jumlah melebihi saldo tersedia (Rp${summary.available.toLocaleString("id-ID")} dari Rp${summary.balance.toLocaleString("id-ID")} — Rp${summary.reserved.toLocaleString("id-ID")} terreserve).`,
    );
  }
  return summary;
}

/** Validate a profit-sharing configuration (§4: company + partner = 100). */
export function validateProfitShare(companyPercent: number, partnerPercent: number): void {
  if (companyPercent <= 0 || partnerPercent <= 0) {
    throw new HttpError(422, "Persentase company dan partner harus lebih besar dari 0.");
  }
  if (Math.abs(companyPercent + partnerPercent - 100) > 0.001) {
    throw new HttpError(422, "Persentase company + partner harus tepat 100%.");
  }
}

/**
 * Resolve the acting partner for the session user. Partner self-service
 * endpoints require the user to actually BE a partner (ownership isolation §39).
 */
export function requirePartner(
  user: AuthUser,
  type?: "MARKETING" | "VEHICLE_OWNER",
): { id: number; type: string } {
  if (!user.partnerId || !user.partnerType) {
    throw new HttpError(403, "Akses ditolak — akun ini bukan partner.");
  }
  if (type && user.partnerType !== type) {
    throw new HttpError(403, `Akses ditolak — endpoint ini hanya untuk partner ${type === "MARKETING" ? "Marketing" : "Vehicle Owner"}.`);
  }
  return { id: user.partnerId, type: user.partnerType };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Audit helper with a stable entityType for financial operations. */
export async function financeAudit(
  user: AuthUser | null,
  action: string,
  entityType: string,
  entityId: number | null,
  entityLabel: string | null,
  extra?: Record<string, unknown>,
): Promise<void> {
  await audit({ action, entityType, entityId, entityLabel, actor: user, after: extra });
}
