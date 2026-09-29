import { db } from "@/lib/db";
import { computePricing, type PricedDetailInput, type PricingMethod } from "@/lib/pricing";

/**
 * DB-dependent pricing helpers (tariff resolution + server-side preview).
 * Split out from `./pricing.ts` (2026-09-27) so the pure formula stays
 * unit-testable without a database connection — see
 * `src/lib/pricing.test.ts` for the formula tests and
 * docs/CLEAN_ARCHITECTURE_PLAN.md §4.2 for the (future) DB-backed test plan
 * for this file.
 */

/**
 * Resolve the tariff that applies to a shipment:
 * 1. the tariff explicitly selected at creation (master.tariffId), or
 * 2. the newest active tariff matching origin → destination and the
 *    customer's type (b2b/b2c), generic tariffs (customerType null) as fallback.
 * Active = isActive and effective window covers today.
 */
export async function resolveTariff(master: {
  tariffId: number | null;
  origin: string;
  destination: string;
  customer: { type: string };
}): Promise<{
  id: number;
  ratePerKg: number;
  minChargeableKg: number;
  volumetricMultiplier: number;
  roundingMode: string;
  roundingUnitKg: number;
  pricingMethod: string;
  ratePerKoli: number | null;
  ratePerCubic: number | null;
  minChargeableKoli: number;
  minChargeableM3: number;
  origin: string;
  destination: string;
  customerType: string | null;
} | null> {
  const now = new Date();

  if (master.tariffId != null) {
    const own = await db.tariff.findFirst({
      where: {
        id: master.tariffId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
    });
    if (own) return own;
  }

  return db.tariff.findFirst({
    where: {
      origin: master.origin,
      destination: master.destination,
      isActive: true,
      effectiveFrom: { lte: now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        // exact customer-type match first, generic (null) as fallback
        { OR: [{ customerType: master.customer.type }, { customerType: null }] },
      ],
    },
    orderBy: [{ customerType: "desc" }, { effectiveFrom: "desc" }],
  });
}

export interface PricingPreview {
  tariffId: number | null;
  ratePerKg: number | null;
  volumetricMultiplier: number;
  minChargeableKg: number;
  roundingMode: string;
  roundingUnitKg: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  estimatedPrice: number | null;
  method: PricingMethod;
  ratePerKoli: number | null;
  ratePerCubic: number | null;
  totalVolumeM3: number;
  koliCount: number;
  chargeableKoli: number;
  chargeableVolumeM3: number;
  rateApplied: number;
}

/** Server-side preview used by GET /shipments/{id} so the UI never hardcodes the formula. */
export async function pricingPreview(master: {
  tariffId: number | null;
  origin: string;
  destination: string;
  customer: { type: string };
  details: PricedDetailInput[];
  priceAmount: number | null;
  chargeableWeightKg: number | null;
}): Promise<PricingPreview | null> {
  const tariff = await resolveTariff(master);
  if (!tariff) return null;
  const r = computePricing(master.details, tariff);
  return {
    tariffId: tariff.id,
    ratePerKg: tariff.ratePerKg,
    volumetricMultiplier: r.multiplier,
    minChargeableKg: tariff.minChargeableKg,
    roundingMode: tariff.roundingMode,
    roundingUnitKg: tariff.roundingUnitKg,
    actualKg: r.actualKg,
    volumetricKg: r.volumetricKg,
    chargeableKg: r.chargeableKg,
    estimatedPrice: master.priceAmount ?? r.price,
    method: r.method,
    ratePerKoli: tariff.ratePerKoli,
    ratePerCubic: tariff.ratePerCubic,
    totalVolumeM3: r.totalVolumeM3,
    koliCount: r.koliCount,
    chargeableKoli: r.chargeableKoli,
    chargeableVolumeM3: r.chargeableVolumeM3,
    rateApplied: r.rateApplied,
  };
}
