import { db } from "@/lib/db";

/**
 * Pricing engine — single source of truth for the volumetric formula, shared
 * by the API price calculation, shipment GET preview, and the seeder.
 *
 * Formula (per user revision):
 *   volumetric kg = (L × W × H in cm) / 1.000.000 × multiplier
 * where `multiplier` = kg per m³ and is configurable per tariff.
 *
 * Chargeable weight = max(total actual kg, total volumetric kg), floored at
 * the tariff's minChargeableKg, then rounded UP (default) / NEAREST to the
 * tariff's rounding unit. Price = chargeable kg × rate per kg.
 */

export const DEFAULT_VOLUMETRIC_MULTIPLIER = 250;

export interface PricedDetailInput {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  actualWeightKg: number;
}

export interface TariffLike {
  ratePerKg: number;
  minChargeableKg: number;
  volumetricMultiplier: number;
  roundingMode: string;
  roundingUnitKg: number;
}

export function volumetricKgFor(
  l: number | null | undefined,
  w: number | null | undefined,
  h: number | null | undefined,
  multiplier: number,
): number {
  const volumeM3 = ((l ?? 0) * (w ?? 0) * (h ?? 0)) / 1_000_000;
  return volumeM3 * multiplier;
}

export interface PricingResult {
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  price: number;
  multiplier: number;
}

export function computePricing(details: PricedDetailInput[], tariff: TariffLike): PricingResult {
  const actualKg = details.reduce((sum, d) => sum + (d.actualWeightKg || 0), 0);
  const multiplier = tariff.volumetricMultiplier > 0 ? tariff.volumetricMultiplier : DEFAULT_VOLUMETRIC_MULTIPLIER;
  const volumetricKg = details.reduce((sum, d) => sum + volumetricKgFor(d.lengthCm, d.widthCm, d.heightCm, multiplier), 0);

  let chargeable = Math.max(actualKg, volumetricKg);
  chargeable = Math.max(chargeable, tariff.minChargeableKg);
  const unit = tariff.roundingUnitKg > 0 ? tariff.roundingUnitKg : 0.5;
  chargeable =
    tariff.roundingMode === "NEAREST"
      ? Math.round(chargeable / unit) * unit
      : Math.ceil(chargeable / unit) * unit;

  const price = Math.round(chargeable * tariff.ratePerKg);
  return { actualKg, volumetricKg, chargeableKg: chargeable, price, multiplier };
}

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
  };
}
