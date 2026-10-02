import { db } from "@/lib/db";

/**
 * Business Rules — Payment & Invoice Integrity (Roadmap Phase 8).
 *
 * P0 invariants:
 *   1. Only VERIFIED payments count toward paidAmount. RECORDED is pending;
 *      REJECTED contributes zero.
 *   2. No overpayment: a recorded payment's amount must not exceed the
 *      shipment's outstanding balance (finalPriceAmount − verified payments),
 *      unless an explicit overpayment policy exists (not the default).
 *   3. Pricing lock: once a VERIFIED payment exists, ordinary repricing is
 *      blocked — an authorized adjustment requires reason + audit.
 *
 * All checks are server-side + re-checked transactionally in the API route.
 */

export const PAYMENT_STATUSES = ["RECORDED", "VERIFIED", "REJECTED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Does this payment status count toward the paid amount? */
export function countsTowardPaid(status: string): boolean {
  return status === "VERIFIED";
}

export interface OutstandingResult {
  /** The final price the customer owes (finalPriceAmount ?? priceAmount ?? 0). */
  finalPrice: number;
  /** Sum of VERIFIED payment amounts. */
  verifiedPaid: number;
  /** finalPrice − verifiedPaid. Never negative (floored at 0). */
  outstanding: number;
}

/**
 * Compute the outstanding balance for a shipment: finalPrice − verified payments.
 * Uses finalPriceAmount (post-discount) when set, otherwise priceAmount.
 */
export async function computeOutstanding(masterId: number): Promise<OutstandingResult> {
  const master = await db.masterShipment.findUnique({
    where: { id: masterId },
    select: { priceAmount: true, finalPriceAmount: true },
  });
  if (!master) {
    return { finalPrice: 0, verifiedPaid: 0, outstanding: 0 };
  }
  const finalPrice = master.finalPriceAmount ?? master.priceAmount ?? 0;
  const payments = await db.payment.findMany({
    where: { masterId, status: "VERIFIED" },
    select: { amount: true },
  });
  const verifiedPaid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const outstanding = Math.max(0, finalPrice - verifiedPaid);
  return { finalPrice, verifiedPaid, outstanding };
}

/**
 * Assert that a new payment of `amount` does not exceed the outstanding balance.
 * Returns an error message if it would overpay, or null if OK.
 *
 * NOTE: the caller MUST re-check this inside the transaction (TOCTOU — between
 * the read and the insert, another payment could be verified). The API route
 * wraps this in a transaction and re-validates.
 */
export async function checkNoOverpayment(masterId: number, amount: number): Promise<string | null> {
  if (amount <= 0) return "Nominal pembayaran harus lebih dari 0.";
  const { outstanding, finalPrice } = await computeOutstanding(masterId);
  if (finalPrice <= 0) return "Harga shipment belum dihitung — tidak bisa mencatat pembayaran.";
  if (amount > outstanding) {
    return `Pembayaran (${amount.toLocaleString("id-ID")}) melebihi sisa tagihan (${outstanding.toLocaleString("id-ID")}). Overpayment tidak diizinkan tanpa kebijakan eksplisit.`;
  }
  return null;
}

/**
 * Assert that the shipment can be repriced. Once a VERIFIED payment exists,
 * ordinary repricing is blocked (Phase 8 pricing lock).
 * Returns an error message if locked, or null if OK.
 */
export async function checkPricingNotLocked(masterId: number): Promise<string | null> {
  const verifiedCount = await db.payment.count({
    where: { masterId, status: "VERIFIED" },
  });
  if (verifiedCount > 0) {
    return `Harga tidak bisa diubah lagi — shipment sudah memiliki ${verifiedCount} pembayaran terverifikasi. Gunakan adjustment berwenang (dengan alasan + audit) untuk koreksi harga.`;
  }
  return null;
}
