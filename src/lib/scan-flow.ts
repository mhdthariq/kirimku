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
  /**
   * B2B Master Resi scan mode — when true, a single Master Resi scan is
   * enough to confirm receipt of the whole shipment (no need to scan each
   * detail barang). Mirrors how B2B shipments are physically handled: the
   * customer hands over a single consignment note (Master Resi) covering
   * all packages in one go.
   */
  isB2B: boolean;
  /** True when at least one Master Resi scan has been recorded (result ok). */
  masterScanned: boolean;
}

export type ScanContext = "pickup" | "delivery" | "gudang_arrival" | "transport_arrival";

/** Normalize a scan method sent by clients ("SCANNED" camera/reader, "TYPED" manual). */
export function normalizeMethod(value: unknown): "SCANNED" | "TYPED" {
  return value === "SCANNED" ? "SCANNED" : "TYPED";
}

/** Resolve the arrival-scan context for a shipment:
 *  - PICKED_UP          → "gudang_arrival"  (kurir drops the packages off at
 *                                             the origin gudang counter)
 *  - AT_DEST_GUDANG      → "transport_arrival" (transport driver checked in at
 *                                             the LAST checkpoint — packages
 *                                             physically at the destination
 *                                             gudang, awaiting Admin Gudang
 *                                             reception scan)
 *  - ARRIVED_AT_GUDANG   → "transport_arrival" (LEGACY rows created before the
 *                             AT_DEST_GUDANG split: arrived but destReceivedAt
 *                             still null — still mid-scan)
 *  Returns null when the shipment is in no arrival-scan state. */
export function arrivalScanContext(status: string, destReceivedAt?: Date | string | null): ScanContext | null {
  if (status === "PICKED_UP") return "gudang_arrival";
  if (status === "AT_DEST_GUDANG") return "transport_arrival";
  if (status === "ARRIVED_AT_GUDANG" && (destReceivedAt == null || destReceivedAt === undefined)) return "transport_arrival";
  return null;
}

/**
 * Resolve the customer type (b2b | b2c) for a master shipment.
 * Returns "b2c" when the master / customer cannot be found (safe default —
 * keeps B2C packages requiring per-detail scans).
 */
async function customerTypeOf(masterId: number): Promise<"b2b" | "b2c"> {
  const row = await db.masterShipment.findUnique({
    where: { id: masterId },
    select: { customer: { select: { type: true } } },
  });
  return row?.customer.type === "b2b" ? "b2b" : "b2c";
}

/**
 * Compute detail-level scan progress for a pickup, a delivery, a gudang
 * arrival (kurir drop-off) or a transport arrival (driver drop-off at the
 * destination gudang). A detail counts as scanned when it has a
 * HandoverScan with result "ok" (or "duplicate" — a repeated confirmation of
 * the same package).
 *
 * B2B Master Resi mode (Revise.md "B2B Master Resi scan"):
 * for B2B shipments, a single Master Resi scan marks the whole shipment as
 * complete — kurir/driver/admin gudang only need to scan the Master Resi
 * once, no per-package scan required. The detail list is still returned for
 * display, but every detail is treated as "scanned" once a master scan is
 * recorded.
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
  let masterScanned = false;
  let masterMethod: string | null = null;
  let masterAt: Date | null = null;
  let masterBy: string | null = null;
  for (const s of scans) {
    // master-level scan (e.g. the kurir / admin scanned the Master Resi)
    if (s.scanLevel === "master") {
      masterScanned = true;
      if (masterAt == null || s.scannedAt < masterAt) {
        masterAt = s.scannedAt;
        masterMethod = s.method;
        masterBy = s.scannedBy?.name ?? null;
      }
    }
    if (s.detailId == null) continue;
    const prev = okByDetail.get(s.detailId);
    if (!prev || s.scannedAt < prev.scannedAt) {
      okByDetail.set(s.detailId, { scannedAt: s.scannedAt, by: s.scannedBy?.name ?? null, method: s.method });
    }
  }

  const details = await detailListFor(options);
  const masterId =
    options.masterId != null
      ? options.masterId
      : options.pickupId != null
        ? (await db.pickup.findUnique({ where: { id: options.pickupId }, select: { masterId: true } }))?.masterId
        : (await db.delivery.findUnique({ where: { id: options.deliveryId! }, select: { masterId: true } }))?.masterId;

  const isB2B = masterId != null && (await customerTypeOf(masterId)) === "b2b";

  const states: ScanDetailState[] = details.map((d) => {
    const hit = okByDetail.get(d.id);
    // B2B shipments: when the master resi has been scanned, every package is
    // implicitly "received" — surface that as a single green state in the UI.
    if (isB2B && masterScanned) {
      return {
        id: d.id,
        detailCode: d.detailCode,
        description: d.description,
        scanned: true,
        scannedAt: masterAt ? masterAt.toISOString() : null,
        scannedByName: masterBy,
        scanMethod: masterMethod,
      };
    }
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

  const scannedCount = states.filter((s) => s.scanned).length;
  const allScanned =
    states.length > 0
      ? isB2B
        ? masterScanned || states.every((s) => s.scanned)
        : states.every((s) => s.scanned)
      : isB2B
        ? masterScanned
        : false;

  return {
    total: states.length,
    scanned: scannedCount,
    allScanned,
    details: states,
    isB2B,
    masterScanned,
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
// Payment helpers (informational only — DP rule dihapus)
// ---------------------------------------------------------------------------
// Aturan baru:
// - B2C: seluruh biaya ditanggung Marketing — tidak ada DP / status pembayaran
//   yang diperiksa di mana pun. Resi hanya menampilkan Nilai Pengiriman.
// - B2B: penagihan via invoice + settlement. Pickup B2B wajib sudah masuk
//   invoice perusahaan customer sebelum bisa di-confirm (gate ada di
//   /pickups + /pickups/[id]/confirm).
//
// paymentSummary() tetap dihitung untuk keperluan display (wallet, dashboard
// keuangan) — field `dpOk` selalu `true` karena aturan DP sudah tidak berlaku.

export interface PaymentSummary {
  priceAmount: number | null;
  discountAmount: number; // Revise.md §6 — Marketing-funded discount
  finalPriceAmount: number | null; // what the customer actually owes
  paidAmount: number; // sum of RECORDED + VERIFIED payments
  remainingAmount: number; // final price - paid (>= 0)
  dpRequirement: number; // deprecated — always 0 (DP rule dihapus)
  dpOk: boolean; // deprecated — always true (DP rule dihapus)
  status: "UNPAID" | "DP" | "PAID" | "UNPRICED";
}

/** Payment summary of a shipment.
 *  Revise.md §6 — the customer owes the DISCOUNTED final price; the company
 *  share is still calculated from the original price at settlement time.
 *  NOTE: DP rule sudah dihapus — `dpOk` selalu `true`. Field tetap dipertahankan
 *  untuk backward-compat dengan UI lama. */
export async function paymentSummary(masterId: number): Promise<PaymentSummary> {
  const [master, payments] = await Promise.all([
    db.masterShipment.findUnique({
      where: { id: masterId },
      select: { priceAmount: true, discountAmount: true, finalPriceAmount: true },
    }),
    db.payment.findMany({ where: { masterId, status: { in: ["RECORDED", "VERIFIED"] } }, select: { amount: true } }),
  ]);
  const priceAmount = master?.priceAmount ?? null;
  const discountAmount = master?.discountAmount ?? 0;
  const finalPriceAmount =
    master?.finalPriceAmount ?? (priceAmount != null ? Math.round((priceAmount - discountAmount) * 100) / 100 : null);
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  if (finalPriceAmount == null || finalPriceAmount <= 0) {
    return {
      priceAmount, discountAmount, finalPriceAmount,
      paidAmount, remainingAmount: 0, dpRequirement: 0, dpOk: true, status: "UNPRICED",
    };
  }
  const remainingAmount = Math.max(0, finalPriceAmount - paidAmount);
  return {
    priceAmount,
    discountAmount,
    finalPriceAmount,
    paidAmount,
    remainingAmount,
    dpRequirement: 0, // deprecated — DP rule dihapus
    dpOk: true, // deprecated — DP rule dihapus, selalu diizinkan
    status: paidAmount >= finalPriceAmount - 0.01 ? "PAID" : paidAmount > 0 ? "DP" : "UNPAID",
  };
}

// ---------------------------------------------------------------------------
// Warehouse scoping — moved to src/lib/gudang-scope.ts (universal: every
// non-owner user is scoped to their employee's gudang; only the owner sees
// data across all gudang).
// ---------------------------------------------------------------------------
