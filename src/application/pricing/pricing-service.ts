import { computePricing } from "@/domain/pricing";
import type {
  PricingPreview,
  PricingPreviewInput,
  PricingRepository,
  PricingTariff,
  TariffSelection,
} from "./pricing-repository";

export function createPricingService(
  repository: PricingRepository,
  clock: () => Date = () => new Date(),
) {
  async function resolveTariff(master: TariffSelection): Promise<PricingTariff | null> {
    const now = clock();
    if (master.tariffId != null) {
      const selected = await repository.findActiveTariffById(master.tariffId, now);
      if (selected) return selected;
    }
    return repository.findMatchingActiveTariff(master, now);
  }

  async function computeServerPricing(master: PricingPreviewInput): Promise<PricingPreview | null> {
    const tariff = await resolveTariff(master);
    if (!tariff) return null;
    const result = computePricing(master.details, tariff);
    return {
      tariffId: tariff.id,
      ratePerKg: tariff.ratePerKg,
      volumetricMultiplier: result.multiplier,
      minChargeableKg: tariff.minChargeableKg,
      roundingMode: tariff.roundingMode,
      roundingUnitKg: tariff.roundingUnitKg,
      actualKg: result.actualKg,
      volumetricKg: result.volumetricKg,
      chargeableKg: result.chargeableKg,
      estimatedPrice: master.priceAmount ?? result.price,
      method: result.method,
      ratePerKoli: tariff.ratePerKoli,
      ratePerCubic: tariff.ratePerCubic,
      totalVolumeM3: result.totalVolumeM3,
      koliCount: result.koliCount,
      chargeableKoli: result.chargeableKoli,
      chargeableVolumeM3: result.chargeableVolumeM3,
      rateApplied: result.rateApplied,
      simpleKg: result.simpleKg,
    };
  }

  return { resolveTariff, computeServerPricing, pricingPreview: computeServerPricing };
}
