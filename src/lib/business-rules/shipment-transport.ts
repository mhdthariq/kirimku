import { db } from "@/lib/db";

/**
 * Business Rules — Shipment / Transport Integrity (Roadmap Phase 2 + 7).
 *
 * P0 invariants enforced here:
 *   1. A shipment has at most ONE active transport (PLANNED + DEPARTED).
 *      The existing composite PK (transportId, shipmentId) only prevents
 *      duplicate assignment INSIDE the same transport — it does NOT prevent
 *      the same shipment from being loaded onto two different active
 *      transports simultaneously. This module closes that gap.
 *   2. A vehicle cannot be on two active transports at the same time
 *      (vehicle scheduling overlap — Phase 7). The existing crew-overlap
 *      check (transport-crew.ts) covers driver/kenek but NOT the vehicle.
 *   3. Transport lifecycle locks: only PLANNED transports are editable.
 *      DEPARTED/ARRIVED/SETTLED transports are structurally locked.
 *
 * All checks are server-side + transactional where required (the caller wraps
 * the assignment in a transaction). Informational capacity status (Phase 1)
 * is separate and never blocks — these rules DO block on data-integrity
 * violations.
 */

export const ACTIVE_TRANSPORT_STATUSES = ["PLANNED", "DEPARTED"] as const;

/** Is the transport status one where the manifest/planning is editable? */
export function isTransportEditable(status: string): boolean {
  return status === "PLANNED";
}

/** Is the transport status one where financial data is locked? */
export function isTransportFinanciallyLocked(status: string, settlementStatus?: string | null): boolean {
  if (status === "ARRIVED" || status === "CANCELLED") return true;
  if (settlementStatus && settlementStatus !== "PENDING") return true;
  return false;
}

// ---------------------------------------------------------------------------
// One active transport per shipment (Phase 2 core invariant)
// ---------------------------------------------------------------------------

export interface ActiveTransportConflict {
  shipmentId: number;
  masterCode: string;
  transportId: number;
  transportCode: string;
  transportStatus: string;
}

/**
 * Find shipments (by id) that are already on an ACTIVE transport, excluding
 * the given transport (for edit-mode checks). Returns the conflict list.
 */
export async function findShipmentActiveTransportConflicts(
  shipmentIds: number[],
  excludeTransportId?: number,
): Promise<ActiveTransportConflict[]> {
  if (shipmentIds.length === 0) return [];
  const rows = await db.transportShipment.findMany({
    where: {
      shipmentId: { in: shipmentIds },
      ...(excludeTransportId != null ? { transportId: { not: excludeTransportId } } : {}),
      transport: { status: { in: ACTIVE_TRANSPORT_STATUSES as unknown as string[] } },
    },
    include: {
      master: { select: { masterCode: true } },
      transport: { select: { transportCode: true, status: true } },
    },
  });
  return rows.map((r) => ({
    shipmentId: r.shipmentId,
    masterCode: r.master.masterCode,
    transportId: r.transportId,
    transportCode: r.transport.transportCode,
    transportStatus: r.transport.status,
  }));
}

/**
 * Assert that NONE of the given shipments are already on an active transport.
 * Returns an error message string if any conflict is found, or null if OK.
 */
export async function checkShipmentNotOnActiveTransport(
  shipmentIds: number[],
  excludeTransportId?: number,
): Promise<string | null> {
  const conflicts = await findShipmentActiveTransportConflicts(shipmentIds, excludeTransportId);
  if (conflicts.length === 0) return null;
  const c = conflicts[0];
  return `Shipment ${c.masterCode} sudah dimuat di transport lain yang aktif (${c.transportCode} — ${c.transportStatus}). Satu shipment hanya boleh ada di satu transport aktif.`;
}

// ---------------------------------------------------------------------------
// Vehicle scheduling overlap (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Find an active transport that already uses the given vehicle, excluding the
 * given transport (for edit-mode). Returns the conflict or null.
 */
export async function findActiveTransportForVehicle(
  vehicleId: number,
  excludeTransportId?: number,
): Promise<{ id: number; transportCode: string; status: string } | null> {
  return db.transport.findFirst({
    where: {
      vehicleId,
      status: { in: ACTIVE_TRANSPORT_STATUSES as unknown as string[] },
      ...(excludeTransportId != null ? { id: { not: excludeTransportId } } : {}),
    },
    select: { id: true, transportCode: true, status: true },
  });
}

/**
 * Assert that the vehicle is not already on an active transport.
 * Returns an error message or null if OK.
 */
export async function checkVehicleAvailable(
  vehicleId: number,
  excludeTransportId?: number,
): Promise<string | null> {
  const conflict = await findActiveTransportForVehicle(vehicleId, excludeTransportId);
  if (!conflict) return null;
  return `Kendaraan sudah ditugaskan di transport lain yang aktif (${conflict.transportCode} — ${conflict.status}). Satu kendaraan hanya boleh di satu transport aktif pada satu waktu.`;
}

// ---------------------------------------------------------------------------
// Transport lifecycle lock helpers (Phase 2/6)
// ---------------------------------------------------------------------------

/** Returns an error message if the transport is not editable (not PLANNED). */
export function checkTransportEditable(status: string, transportCode: string): string | null {
  if (!isTransportEditable(status)) {
    return `Transport ${transportCode} berstatus ${status} — hanya transport PLANNED yang bisa diubah. Gunakan override berwenang untuk koreksi pasca-keberangkatan.`;
  }
  return null;
}

/** Returns an error message if the transport's financial data is locked. */
export function checkTransportFinanciallyEditable(
  status: string,
  settlementStatus: string | null | undefined,
  transportCode: string,
): string | null {
  if (isTransportFinanciallyLocked(status, settlementStatus ?? undefined)) {
    const lockReason = status === "ARRIVED" ? "sudah tiba"
      : status === "CANCELLED" ? "dibatalkan"
      : settlementStatus && settlementStatus !== "PENDING" ? `sudah di-settle (${settlementStatus})`
      : "terkunci";
    return `Transport ${transportCode} ${lockReason} — data keuangan terkunci. Koreksi memerlukan override berwenang + audit.`;
  }
  return null;
}
