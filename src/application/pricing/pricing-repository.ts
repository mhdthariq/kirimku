import type { PricedDetailInput, PricingMethod } from "@/domain/pricing";

export interface TariffSelection {
  tariffId: number | null;
  origin: string;
  destination: string;
  customerId?: number | null;
  customer: { type: string };
}

export interface PricingTariff {
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
  customerId: number | null;
}

/** Persistence queries must only return tariffs active at the supplied instant. */
export interface PricingRepository {
  findActiveTariffById(id: number, at: Date): Promise<PricingTariff | null>;
  /** Match route and customer type (or generic), excluding other customers' tariffs. */
  findMatchingActiveTariff(selection: TariffSelection, at: Date): Promise<PricingTariff | null>;
}

export interface PricingPreviewInput extends TariffSelection {
  details: PricedDetailInput[];
  priceAmount: number | null;
  chargeableWeightKg: number | null;
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
  simpleKg: boolean;
}
