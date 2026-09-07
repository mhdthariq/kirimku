import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";

export interface ScanDetailState {
  id: number;
  detailCode: string;
  description: string;
  quantity: number;
  scanned: boolean;
  scannedAt: string | null;
  scannedByName: string | null;
}

export interface ScanProgress {
  total: number;
  scanned: number;
  allScanned: boolean;
  details: ScanDetailState[];
}

/**
 * Compute detail-level scan progress for a pickup or delivery.
 * A detail counts as scanned when it has a HandoverScan with result "ok"
 * (or "duplicate" — a repeated confirmation of the same package).
 */
export async function scanProgress(options: { pickupId?: number; deliveryId?: number }): Promise<ScanProgress> {
  const where = options.pickupId != null ? { pickupId: options.pickupId } : { deliveryId: options.deliveryId };
  const scans = await db.handoverScan.findMany({
    where: { ...where, result: { in: ["ok", "duplicate"] } },
    include: { scannedBy: true },
  });
  const okByDetail = new Map<number, { scannedAt: Date; by: string | null }>();
  for (const s of scans) {
    if (s.detailId == null) continue;
    const prev = okByDetail.get(s.detailId);
    if (!prev || s.scannedAt < prev.scannedAt) {
      okByDetail.set(s.detailId, { scannedAt: s.scannedAt, by: s.scannedBy?.name ?? null });
    }
  }

  const details = await detailListFor(options);
  const states: ScanDetailState[] = details.map((d) => {
    const hit = okByDetail.get(d.id);
    return {
      id: d.id,
      detailCode: d.detailCode,
      description: d.description,
      quantity: d.quantity,
      scanned: !!hit,
      scannedAt: hit ? hit.scannedAt.toISOString() : null,
      scannedByName: hit?.by ?? null,
    };
  });
  return {
    total: states.length,
    scanned: states.filter((s) => s.scanned).length,
    allScanned: states.length > 0 && states.every((s) => s.scanned),
    details: states,
  };
}

async function detailListFor(options: { pickupId?: number; deliveryId?: number }) {
  const masterId = options.pickupId != null
    ? (await db.pickup.findUnique({ where: { id: options.pickupId }, select: { masterId: true } }))?.masterId
    : (await db.delivery.findUnique({ where: { id: options.deliveryId! }, select: { masterId: true } }))?.masterId;
  if (masterId == null) return [];
  return db.detailShipment.findMany({ where: { masterId }, orderBy: { id: "asc" } });
}

/**
 * Validate that the requesting user may scan/confirm the given task:
 * the assigned kurir, a supervisor holding `overridePermission`, or the owner.
 * Returns an error message when not allowed, null when allowed.
 */
export function assertKurirAssignment(
  task: { kurirId: number | null },
  user: AuthUser,
  overridePermission: string,
  label: string,
): string | null {
  if (task.kurirId == null) return null; // unassigned — supervisors handle it
  if (user.employeeId != null && task.kurirId === user.employeeId) return null;
  if (user.isOwner || user.permissions.includes("*")) return null;
  if (user.permissions.includes(overridePermission)) return null;
  return `Task ${label} ditugaskan ke kurir lain — hanya kurir bersangkutan atau supervisor yang boleh memproses.`;
}
