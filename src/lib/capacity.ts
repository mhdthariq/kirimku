/**
 * Vehicle Capacity Status & Operational Load Monitoring (Capacity Round).
 *
 * DESIGN PRINCIPLES (from the plan — DO NOT change without reading the plan):
 * 1. Capacity is INFORMATIONAL ONLY — it MUST NEVER block shipment/resi
 *    assignment, transport creation, or departure. This module produces status
 *    badges; it does not throw or reject.
 * 2. The three capacity dimensions (Weight / Volume / Koli) are INDEPENDENT.
 *    A vehicle may be OVERLIMIT on weight but OK on volume, etc.
 * 3. Vehicle WEIGHT capacity uses ACTUAL physical weight (actualWeightKg),
 *    NOT chargeable weight (chargeableWeightKg is a billing concept).
 * 4. One shared volume calculation (`calculateDetailVolume`) is reused by
 *    pricing, shipment totals, transport totals, and now capacity — so the
 *    number is identical everywhere.
 * 5. NULL / 0 maximum = UNCONFIGURED (the company has not set a limit), NOT
 *    "zero capacity". A negative maximum is invalid and also treated as
 *    UNCONFIGURED (the vehicle master-data API rejects negatives at write
 *    time, but we guard here too so the status is always safe to render).
 * 6. Statuses are computed on-the-fly from current load + vehicle capacity —
 *    we never persist derived `isOverlimit` booleans (they go stale).
 */

// ---------------------------------------------------------------------------
// Shared volume calculation — the single source of truth for a package's m³.
// Kept identical to the (private) `detailVolumeM3` in ./pricing.ts so the
// pricing engine, shipment totals, transport totals, and capacity monitoring
// all agree. Exported here so transport/capacity code does not reach into the
// pricing module's internals.
// ---------------------------------------------------------------------------

export interface VolumeInput {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  /** Optional direct volume entry (m³) — wins over L×W×H when set (> 0). */
  volumeM3?: number | null;
}

/**
 * Calculate the physical volume (m³) of a single detail/package row.
 *  - If `volumeM3` is set (non-null, > 0), use it directly.
 *  - Otherwise fall back to (L × W × H in cm) / 1.000.000.
 *  - Returns 0 when neither path yields a positive number.
 *
 * This is the SHARED calculation referenced by the plan (§7). It must stay in
 * sync with pricing.ts:detailVolumeM3.
 */
export function calculateDetailVolume(d: VolumeInput): number {
  if (d.volumeM3 != null && d.volumeM3 > 0) return d.volumeM3;
  return ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Capacity status — one dimension (weight OR volume OR koli)
// ---------------------------------------------------------------------------

export type CapacityState = "OK" | "WARNING" | "OVERLIMIT" | "UNCONFIGURED";

/** Default utilization % at which a dimension flips from OK → WARNING (near-limit).
 *  Plan §31 future SOFT limit preview — still informational, never blocks. */
export const DEFAULT_WARNING_THRESHOLD = 90;

export interface CapacityStatus {
  /** Current load for this dimension (actual weight kg / volume m³ / koli count). */
  current: number;
  /** Configured maximum, or null when unconfigured. */
  maximum: number | null;
  /** current / maximum × 100, rounded to 2 dp. Null when unconfigured. */
  utilizationPercent: number | null;
  /** maximum − current. Positive = headroom; negative = over. Null when unconfigured. */
  remaining: number | null;
  /** How far over the limit the load is (0 when within limit). Null when unconfigured. */
  overBy: number | null;
  status: CapacityState;
}

/**
 * Compute the status of ONE capacity dimension.
 *
 * Rules (plan §3/§4/§5/§10/§22 + §31 future SOFT limit):
 *   maximum == null OR maximum <= 0  → UNCONFIGURED
 *   current  > maximum              → OVERLIMIT
 *   utilization >= warningThreshold → WARNING (near-limit, plan §31 SOFT preview)
 *   current <= maximum              → OK
 *
 * `warningThreshold` defaults to 90 (%) — a dimension at 90%+ utilization but
 * not yet over is flagged WARNING so operators get an early heads-up. The
 * WARNING state is informational (never blocks), distinct from OVERLIMIT.
 *
 * `roundTo` controls the precision of current/maximum/remaining/overBy
 * (kg → 2 dp, volume m³ → 6 dp, koli → 0 dp). Utilization is always 2 dp.
 */
export function computeDimensionStatus(
  currentRaw: number,
  maximumRaw: number | null,
  roundTo = 2,
  warningThreshold = DEFAULT_WARNING_THRESHOLD,
): CapacityStatus {
  const current = round(currentRaw, roundTo);
  // null / 0 / negative maximum → the company has not configured a real limit.
  const maximum = maximumRaw != null && maximumRaw > 0 ? round(maximumRaw, roundTo) : null;

  if (maximum == null) {
    return {
      current,
      maximum: null,
      utilizationPercent: null,
      remaining: null,
      overBy: null,
      status: "UNCONFIGURED",
    };
  }

  const remaining = round(maximum - current, roundTo);
  const overBy = current > maximum ? round(current - maximum, roundTo) : 0;
  const utilizationPercent = round((current / maximum) * 100, 2);
  let status: CapacityState;
  if (current > maximum) {
    status = "OVERLIMIT";
  } else if (utilizationPercent >= warningThreshold) {
    status = "WARNING";
  } else {
    status = "OK";
  }

  return { current, maximum, utilizationPercent, remaining, overBy, status };
}

// ---------------------------------------------------------------------------
// Transport load — the actual cargo currently assigned to a transport
// ---------------------------------------------------------------------------

export interface TransportLoad {
  /** SUM of actualWeightKg across all assigned packages (physical cargo weight). */
  totalActualWeightKg: number;
  /** SUM of calculateDetailVolume across all assigned packages (m³). */
  totalVolumeM3: number;
  /** COUNT of assigned DetailShipment/package records (1 detail = 1 koli). */
  totalKoli: number;
}

// ---------------------------------------------------------------------------
// Vehicle capacity configuration
// ---------------------------------------------------------------------------

export interface VehicleCapacity {
  maxWeightKg: number | null;
  maxVolumeM3: number | null;
  maxKoli: number | null;
}

// ---------------------------------------------------------------------------
// Overall transport capacity status
// ---------------------------------------------------------------------------

export type OverallCapacityState = "OK" | "WARNING" | "OVERLIMIT" | "PARTIALLY_CONFIGURED" | "UNCONFIGURED";

export interface TransportCapacityStatus {
  overallStatus: OverallCapacityState;
  weight: CapacityStatus;
  volume: CapacityStatus;
  koli: CapacityStatus;
}

/**
 * Compute the full capacity status of a transport from its vehicle config +
 * current load. PURE function — no DB, no side effects, never throws.
 *
 * Weight  → ACTUAL kg (plan §6), 2 dp.
 * Volume  → shared calculateDetailVolume sum (plan §7), 6 dp.
 * Koli    → COUNT of packages (plan §5/§8), 0 dp.
 *
 * overallStatus (plan §15 + §31 future SOFT limit):
 *   any dimension OVERLIMIT                 → OVERLIMIT
 *   any dimension WARNING (rest OK/UNCONFIGURED) → WARNING (near-limit)
 *   all configured dimensions OK            → OK
 *   some dimensions UNCONFIGURED (rest OK, no warning/over) → PARTIALLY_CONFIGURED
 *   all three UNCONFIGURED                  → UNCONFIGURED
 *
 * `warningThreshold` (default 90%) — a dimension at >= threshold utilization
 * but not over is WARNING. Plan §31 future SOFT limit preview; informational.
 */
export function calculateTransportCapacityStatus(
  vehicle: VehicleCapacity,
  load: TransportLoad,
  warningThreshold = DEFAULT_WARNING_THRESHOLD,
): TransportCapacityStatus {
  const weight = computeDimensionStatus(load.totalActualWeightKg, vehicle.maxWeightKg, 2, warningThreshold);
  const volume = computeDimensionStatus(load.totalVolumeM3, vehicle.maxVolumeM3, 6, warningThreshold);
  const koli = computeDimensionStatus(load.totalKoli, vehicle.maxKoli, 0, warningThreshold);

  const statuses = [weight.status, volume.status, koli.status] as const;
  const anyOver = statuses.some((s) => s === "OVERLIMIT");
  const anyWarning = statuses.some((s) => s === "WARNING");
  const anyUnconfigured = statuses.some((s) => s === "UNCONFIGURED");
  const allUnconfigured = statuses.every((s) => s === "UNCONFIGURED");

  let overallStatus: OverallCapacityState;
  if (anyOver) {
    overallStatus = "OVERLIMIT";
  } else if (anyWarning) {
    overallStatus = "WARNING";
  } else if (allUnconfigured) {
    overallStatus = "UNCONFIGURED";
  } else if (anyUnconfigured) {
    overallStatus = "PARTIALLY_CONFIGURED";
  } else {
    overallStatus = "OK";
  }

  return { overallStatus, weight, volume, koli };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * f) / f;
}

/** Human label for an overall status (Indonesian UI). */
export function overallStatusLabel(s: OverallCapacityState): string {
  switch (s) {
    case "OK":
      return "Aman";
    case "WARNING":
      return "Hampir Penuh";
    case "OVERLIMIT":
      return "Over Kapasitas";
    case "PARTIALLY_CONFIGURED":
      return "Sebagian Tak Terisi";
    case "UNCONFIGURED":
      return "Belum Dikonfigurasi";
  }
}

/** Human label for a single dimension status. */
export function dimensionStatusLabel(s: CapacityState): string {
  switch (s) {
    case "OK":
      return "OK";
    case "WARNING":
      return "Hampir Penuh";
    case "OVERLIMIT":
      return "Over Limit";
    case "UNCONFIGURED":
      return "Belum Dikonfigurasi";
  }
}
