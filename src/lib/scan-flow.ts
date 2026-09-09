import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";

export interface ScanDetailState {
  id: number;
  detailCode: string;
  description: string;
  scanned: boolean;
  scannedAt: string | null;
  scannedByName: string | null;
  /** SCANNED (camera / reader tool) | TYPED (manual input) — shown in Riwayat Scan */
  scanMethod: string | null;
}

export interface ScanProgress {
  total: number;
  scanned: number;
  allScanned: boolean;
  details: ScanDetailState[];
}

export type ScanContext = "pickup" | "delivery" | "gudang_arrival";

/** Normalize a scan method sent by clients ("SCANNED" camera/reader, "TYPED" manual). */
export function normalizeMethod(value: unknown): "SCANNED" | "TYPED" {
  return value === "SCANNED" ? "SCANNED" : "TYPED";
}

/**
 * Compute detail-level scan progress for a pickup, a delivery, or a gudang
 * arrival (context + masterId). A detail counts as scanned when it has a
 * HandoverScan with result "ok" (or "duplicate" — a repeated confirmation of
 * the same package).
 */
export async function scanProgress(options: { pickupId?: number; deliveryId?: number; masterId?: number; context?: ScanContext }): Promise<ScanProgress> {
  const where =
    options.pickupId != null
      ? { pickupId: options.pickupId }
      : options.deliveryId != null
        ? { deliveryId: options.deliveryId }
        : { masterId: options.masterId, context: options.context ?? "gudang_arrival" };
  const scans = await db.handoverScan.findMany({
    where: { ...where, result: { in: ["ok", "duplicate"] } },
    include: { scannedBy: true },
  });
  const okByDetail = new Map<number, { scannedAt: Date; by: string | null; method: string }>();
  for (const s of scans) {
    if (s.detailId == null) continue;
    const prev = okByDetail.get(s.detailId);
    if (!prev || s.scannedAt < prev.scannedAt) {
      okByDetail.set(s.detailId, { scannedAt: s.scannedAt, by: s.scannedBy?.name ?? null, method: s.method });
    }
  }

  const details = await detailListFor(options);
  const states: ScanDetailState[] = details.map((d) => {
    const hit = okByDetail.get(d.id);
    return {
      id: d.id,
      detailCode: d.detailCode,
      description: d.description,
      scanned: !!hit,
      scannedAt: hit ? hit.scannedAt.toISOString() : null,
      scannedByName: hit?.by ?? null,
      scanMethod: hit?.method ?? null,
    };
  });
  return {
    total: states.length,
    scanned: states.filter((s) => s.scanned).length,
    allScanned: states.length > 0 && states.every((s) => s.scanned),
    details: states,
  };
}

async function detailListFor(options: { pickupId?: number; deliveryId?: number; masterId?: number }) {
  const masterId =
    options.masterId != null
      ? options.masterId
      : options.pickupId != null
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

// ---------------------------------------------------------------------------
// Payment / DP helpers (gudang + pickup gates)
// ---------------------------------------------------------------------------

export interface PaymentSummary {
  priceAmount: number | null;
  paidAmount: number; // sum of RECORDED + VERIFIED payments
  remainingAmount: number; // price - paid (>= 0)
  dpRequirement: number; // 50% of price
  dpOk: boolean; // paid >= 50% of price
  status: "UNPAID" | "DP" | "PAID" | "UNPRICED";
}

/** Payment summary of a shipment: DP rule = at least 50% paid before pickup. */
export async function paymentSummary(masterId: number): Promise<PaymentSummary> {
  const [master, payments] = await Promise.all([
    db.masterShipment.findUnique({ where: { id: masterId }, select: { priceAmount: true } }),
    db.payment.findMany({ where: { masterId, status: { in: ["RECORDED", "VERIFIED"] } }, select: { amount: true } }),
  ]);
  const priceAmount = master?.priceAmount ?? null;
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  if (priceAmount == null || priceAmount <= 0) {
    return { priceAmount, paidAmount, remainingAmount: 0, dpRequirement: 0, dpOk: false, status: "UNPRICED" };
  }
  const dpRequirement = priceAmount / 2;
  const remainingAmount = Math.max(0, priceAmount - paidAmount);
  return {
    priceAmount,
    paidAmount,
    remainingAmount,
    dpRequirement,
    dpOk: paidAmount >= dpRequirement - 0.01,
    status: paidAmount >= priceAmount - 0.01 ? "PAID" : paidAmount > 0 ? "DP" : "UNPAID",
  };
}

// ---------------------------------------------------------------------------
// Warehouse scoping (roles below Admin Gudang see only their own gudang)
// ---------------------------------------------------------------------------

/**
 * Resolve the gudang scope for a user:
 * - null → unscoped (Admin Gudang / owner): sees every gudang
 * - number → scoped user (holds `warehouse.scope_own`): only their gudang
 */
export async function gudangScopeFor(user: AuthUser): Promise<number | null> {
  if (user.isOwner || user.permissions.includes("*")) return null;
  if (!user.permissions.includes("warehouse.scope_own")) return null;
  if (user.employeeId == null) return null;
  const employee = await db.employee.findUnique({ where: { id: user.employeeId }, select: { warehouseId: true } });
  return employee?.warehouseId ?? null;
}

/** Does a shipment belong to the given gudang scope (by warehouse id or origin city)? */
export function shipmentInScope(
  shipment: { originWarehouseId: number | null; origin: string },
  scopeWarehouseId: number | null,
  warehouseCities: Map<number, string>,
): boolean {
  if (scopeWarehouseId == null) return true;
  if (shipment.originWarehouseId != null) return shipment.originWarehouseId === scopeWarehouseId;
  const city = warehouseCities.get(scopeWarehouseId);
  return !!city && shipment.origin.toLowerCase() === city.toLowerCase();
}
