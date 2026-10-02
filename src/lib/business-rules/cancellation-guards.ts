import { db } from "@/lib/db";

/**
 * Business Rules — Shipment Cancellation Guards (Roadmap Phase 4).
 *
 * Before a shipment can be cancelled, these operational/financial checks must
 * pass. The existing `canTransition` only checks the state-machine edge — it
 * doesn't check for active operational links or financial commitments.
 *
 * Rules:
 *   1. If the shipment is on an ACTIVE transport (PLANNED + DEPARTED), it must
 *      be removed from the transport first (or the cancel must also unlink it).
 *      Cancelling a shipment that's physically on a moving truck is not allowed.
 *   2. If there's an active delivery (ASSIGNED / IN_PROGRESS), it must be
 *      cancelled first.
 *   3. If there are VERIFIED payments, the operator is warned (but the cancel
 *      is allowed — financial corrections happen separately via adjustments).
 *
 * Returns an error message string if cancellation is blocked, or null if OK.
 */

export interface CancellationCheckResult {
  /** Error message if cancellation is blocked, or null if OK. */
  error: string | null;
  /** Warnings (non-blocking) — e.g. verified payments exist. */
  warnings: string[];
}

export async function checkCancellationGuards(masterId: number, currentStatus: string): Promise<CancellationCheckResult> {
  const warnings: string[] = [];

  // 1. Active transport assignment — block if the shipment is on an active transport.
  const activeTransportLink = await db.transportShipment.findFirst({
    where: {
      shipmentId: masterId,
      transport: { status: { in: ["PLANNED", "DEPARTED"] } },
    },
    include: { transport: { select: { transportCode: true, status: true } } },
  });
  if (activeTransportLink) {
    return {
      error: `Shipment masih dimuat di transport aktif ${activeTransportLink.transport.transportCode} (${activeTransportLink.transport.status}). Hapus shipment dari transport tersebut sebelum membatalkan.`,
      warnings,
    };
  }

  // 2. Active delivery — block if there's an ASSIGNED or IN_PROGRESS delivery.
  const activeDelivery = await db.delivery.findFirst({
    where: { masterId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
    select: { deliveryCode: true, status: true },
  });
  if (activeDelivery) {
    return {
      error: `Masih ada tugas delivery aktif (${activeDelivery.deliveryCode} — ${activeDelivery.status}). Batalkan delivery tersebut sebelum membatalkan shipment.`,
      warnings,
    };
  }

  // 3. Verified payments — warn (non-blocking). Financial corrections happen
  // separately via wallet adjustments / payment reversals.
  const verifiedPaymentCount = await db.payment.count({
    where: { masterId, status: "VERIFIED" },
  });
  if (verifiedPaymentCount > 0) {
    warnings.push(
      `Shipment memiliki ${verifiedPaymentCount} pembayaran terverifikasi. Pembatalan shipment tidak membatalkan pembayaran otomatis — proses refund/adjustment secara terpisah.`,
    );
  }

  // 4. Active pickup (ASSIGNED/IN_PROGRESS) — warn but allow (the pickup will
  // be orphaned, but the operator can clean it up).
  const activePickup = await db.pickup.findFirst({
    where: { masterId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
    select: { pickupCode: true, status: true },
  });
  if (activePickup) {
    warnings.push(
      `Shipment memiliki tugas pickup aktif (${activePickup.pickupCode} — ${activePickup.status}). Pickup akan menjadi yatim setelah pembatalan — batalkan pickup secara terpisah jika perlu.`,
    );
  }

  return { error: null, warnings };
}
