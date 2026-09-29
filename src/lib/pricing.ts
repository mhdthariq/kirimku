/**
 * Pricing engine — single source of truth for the volumetric formula, shared
 * by the API price calculation, shipment GET preview, and the seeder.
 *
 * IMPORTANT: this file is intentionally framework/DB-free (no import of
 * `@/lib/db`) so it can be unit-tested in isolation — see
 * `src/lib/pricing.test.ts`. Anything that needs the database (resolving a
 * tariff, building a server-side preview) lives in `./pricing-server.ts`
 * instead, which imports the pure functions from here.
 *
 * Formula (per user revision):
 *   volumetric kg = (L × W × H in cm) / 1.000.000 × multiplier
 * where `multiplier` = kg per m³ and is configurable per tariff.
 *
 * Chargeable weight = max(total actual kg, total volumetric kg), floored at
 * the tariff's minChargeableKg, then rounded UP (default) / NEAREST to the
 * tariff's rounding unit. Price = chargeable kg × rate per kg.
 *
 * B2B pricing methods — every tariff carries ONE pricing method:
 *   - PER_KG    (default, and the ONLY method B2C ever uses): the formula
 *               above, unchanged.
 *   - PER_KOLI  price = max(package count, minChargeableKoli) × ratePerKoli.
 *   - PER_CUBIC price = max(total volume m³, minChargeableM3) × ratePerCubic.
 * Picking a tariff at shipment-creation time IS picking the method — the
 * operator sees the method on the tariff (Tarif page / shipment tariff
 * dropdown) and chooses the one that fits (kg / koli / cubic).
 */

export const DEFAULT_VOLUMETRIC_MULTIPLIER = 250;

export type PricingMethod = "PER_KG" | "PER_KOLI" | "PER_CUBIC";

export function normalizePricingMethod(value: unknown): PricingMethod {
  return value === "PER_KOLI" || value === "PER_CUBIC" ? value : "PER_KG";
}

export interface PricedDetailInput {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  actualWeightKg: number;
  /** Revise round 11 — optional direct volume entry (m³). When set (> 0),
   *  this value is used directly instead of computing L×W×H/1.000.000. */
  volumeM3?: number | null;
}

export interface TariffLike {
  ratePerKg: number;
  minChargeableKg: number;
  volumetricMultiplier: number;
  roundingMode: string;
  roundingUnitKg: number;
  /** B2B pricing method. Defaults to "PER_KG" when absent (legacy tariffs /
   *  B2C tariffs — B2C never uses anything else). */
  pricingMethod?: string | null;
  ratePerKoli?: number | null;
  ratePerCubic?: number | null;
  minChargeableKoli?: number | null;
  minChargeableM3?: number | null;
}

/** Compute the volume (m³) of a single detail row.
 *  - If `volumeM3` is set (non-null, > 0), use it directly.
 *  - Otherwise, fall back to L×W×H/1.000.000 (existing behavior).
 *  - Returns 0 when neither path yields a positive number. */
function detailVolumeM3(d: PricedDetailInput): number {
  if (d.volumeM3 != null && d.volumeM3 > 0) return d.volumeM3;
  return ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000;
}

/** Volumetric kg for a single package — uses `volumeM3` when set, otherwise
 *  falls back to the L×W×H computation. Multiplier = kg per m³ (per tariff). */
export function volumetricKgForDetail(d: PricedDetailInput, multiplier: number): number {
  return detailVolumeM3(d) * multiplier;
}

export interface PricingResult {
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  price: number;
  multiplier: number;
  /** Which method actually produced `price` for this shipment. */
  method: PricingMethod;
  /** Total physical volume (m³) across all details — always computed,
   *  regardless of method, so the UI can always show it for reference. */
  totalVolumeM3: number;
  /** Package (koli) count — always computed for reference. */
  koliCount: number;
  /** Chargeable koli — only meaningful when method === "PER_KOLI". */
  chargeableKoli: number;
  /** Chargeable volume (m³) — only meaningful when method === "PER_CUBIC". */
  chargeableVolumeM3: number;
  /** The rate actually applied (ratePerKg / ratePerKoli / ratePerCubic). */
  rateApplied: number;
}

export function computePricing(details: PricedDetailInput[], tariff: TariffLike): PricingResult {
  const actualKg = details.reduce((sum, d) => sum + (d.actualWeightKg || 0), 0);
  const multiplier = tariff.volumetricMultiplier > 0 ? tariff.volumetricMultiplier : DEFAULT_VOLUMETRIC_MULTIPLIER;
  // Revise round 11 — use volumetricKgForDetail so packages with `volumeM3`
  // set use that value directly instead of L×W×H.
  const volumetricKg = details.reduce((sum, d) => sum + volumetricKgForDetail(d, multiplier), 0);
  const totalVolumeM3 = details.reduce((sum, d) => sum + detailVolumeM3(d), 0);
  const koliCount = details.length;

  let chargeableKg = Math.max(actualKg, volumetricKg);
  chargeableKg = Math.max(chargeableKg, tariff.minChargeableKg);
  const unit = tariff.roundingUnitKg > 0 ? tariff.roundingUnitKg : 0.5;
  chargeableKg =
    tariff.roundingMode === "NEAREST"
      ? Math.round(chargeableKg / unit) * unit
      : Math.ceil(chargeableKg / unit) * unit;

  const method = normalizePricingMethod(tariff.pricingMethod);

  let price: number;
  let rateApplied: number;
  let chargeableKoli = 0;
  let chargeableVolumeM3 = 0;

  if (method === "PER_KOLI") {
    chargeableKoli = Math.max(koliCount, tariff.minChargeableKoli ?? 1);
    rateApplied = tariff.ratePerKoli ?? 0;
    price = Math.round(chargeableKoli * rateApplied);
  } else if (method === "PER_CUBIC") {
    chargeableVolumeM3 = Math.max(totalVolumeM3, tariff.minChargeableM3 ?? 0);
    rateApplied = tariff.ratePerCubic ?? 0;
    price = Math.round(chargeableVolumeM3 * rateApplied);
  } else {
    rateApplied = tariff.ratePerKg;
    price = Math.round(chargeableKg * tariff.ratePerKg);
  }

  return {
    actualKg,
    volumetricKg,
    chargeableKg,
    price,
    multiplier,
    method,
    totalVolumeM3,
    koliCount,
    chargeableKoli,
    chargeableVolumeM3,
    rateApplied,
  };
}
