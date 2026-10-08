import { describe, expect, it, vi } from "vitest";
import { createPricingService } from "@/application/pricing/pricing-service";
import type {
  PricingPreviewInput,
  PricingRepository,
  PricingTariff,
} from "@/application/pricing/pricing-repository";

const at = new Date("2026-10-08T12:00:00Z");
const tariff: PricingTariff = {
  id: 7,
  origin: "Jakarta",
  destination: "Bandung",
  customerType: "b2c",
  customerId: null,
  ratePerKg: 1000,
  minChargeableKg: 1,
  volumetricMultiplier: 250,
  roundingMode: "UP",
  roundingUnitKg: 0.5,
  pricingMethod: "PER_KG",
  ratePerKoli: null,
  ratePerCubic: null,
  minChargeableKoli: 1,
  minChargeableM3: 0,
};
const master: PricingPreviewInput = {
  tariffId: null,
  origin: "Jakarta",
  destination: "Bandung",
  customerId: 42,
  customer: { type: "b2c" },
  details: [{ actualWeightKg: 2.1, volumeM3: 0.01 }],
  priceAmount: null,
  chargeableWeightKg: null,
};

function setup(matching: PricingTariff | null = tariff) {
  const repository = {
    findActiveTariffById: vi.fn<PricingRepository["findActiveTariffById"]>().mockResolvedValue(null),
    findMatchingActiveTariff: vi.fn<PricingRepository["findMatchingActiveTariff"]>().mockResolvedValue(matching),
  };
  const clock = vi.fn(() => at);
  return { repository, clock, service: createPricingService(repository, clock) };
}

describe("pricing application", () => {
  it("uses an active explicitly selected tariff without route/customer fallback", async () => {
    const { repository, service } = setup();
    const selected = { ...tariff, origin: "Other", customerId: 99 };
    repository.findActiveTariffById.mockResolvedValue(selected);
    expect(await service.resolveTariff({ ...master, tariffId: 0 })).toBe(selected);
    expect(repository.findActiveTariffById).toHaveBeenCalledWith(0, at);
    expect(repository.findMatchingActiveTariff).not.toHaveBeenCalled();
  });

  it("falls back when the selected tariff is missing or inactive using one clock instant", async () => {
    const { repository, clock, service } = setup();
    const input = { ...master, tariffId: 123 };
    expect(await service.resolveTariff(input)).toBe(tariff);
    expect(repository.findActiveTariffById).toHaveBeenCalledWith(123, at);
    expect(repository.findMatchingActiveTariff).toHaveBeenCalledWith(input, at);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it("passes route, customer type and optional customer identity to the repository", async () => {
    const { repository, service } = setup();
    const { customerId: omitted, ...input } = master;
    expect(omitted).toBe(42);
    await service.resolveTariff(input);
    expect(repository.findActiveTariffById).not.toHaveBeenCalled();
    expect(repository.findMatchingActiveTariff).toHaveBeenCalledWith(input, at);
  });

  it("returns null when no applicable tariff exists, even with a saved price", async () => {
    const { service } = setup(null);
    expect(await service.computeServerPricing({ ...master, priceAmount: 500 })).toBeNull();
  });

  it("maps the complete domain calculation to the existing preview contract", async () => {
    const { service } = setup();
    expect(await service.computeServerPricing(master)).toEqual({
      tariffId: 7,
      ratePerKg: 1000,
      volumetricMultiplier: 250,
      minChargeableKg: 1,
      roundingMode: "UP",
      roundingUnitKg: 0.5,
      actualKg: 2.1,
      volumetricKg: 2.5,
      chargeableKg: 2.5,
      estimatedPrice: 2500,
      method: "PER_KG",
      ratePerKoli: null,
      ratePerCubic: null,
      totalVolumeM3: 0.01,
      koliCount: 1,
      chargeableKoli: 0,
      chargeableVolumeM3: 0,
      rateApplied: 1000,
      simpleKg: false,
    });
    expect(service.pricingPreview).toBe(service.computeServerPricing);
  });

  it.each([0, 1234])("preserves saved price %s but recomputes chargeable weight", async (priceAmount) => {
    const { service } = setup();
    expect(await service.pricingPreview({ ...master, priceAmount, chargeableWeightKg: 99 }))
      .toMatchObject({ estimatedPrice: priceAmount, chargeableKg: 2.5 });
  });

  it("delegates simple B2B kg pricing without volumetric billing or rounding", async () => {
    const { service } = setup({ ...tariff, customerType: "b2b" });
    expect(await service.computeServerPricing(master)).toMatchObject({
      simpleKg: true, chargeableKg: 2.1, estimatedPrice: 2100, method: "PER_KG",
    });
  });

  it("delegates koli pricing including its minimum and applied rate", async () => {
    const { service } = setup({ ...tariff, pricingMethod: "PER_KOLI", ratePerKoli: 1200, minChargeableKoli: 3 });
    expect(await service.computeServerPricing(master)).toMatchObject({
      method: "PER_KOLI", chargeableKoli: 3, koliCount: 1, rateApplied: 1200, estimatedPrice: 3600,
    });
  });

  it("delegates cubic pricing including direct volume and its minimum", async () => {
    const { service } = setup({ ...tariff, pricingMethod: "PER_CUBIC", ratePerCubic: 100000, minChargeableM3: 0.1 });
    expect(await service.computeServerPricing(master)).toMatchObject({
      method: "PER_CUBIC", totalVolumeM3: 0.01, chargeableVolumeM3: 0.1,
      rateApplied: 100000, estimatedPrice: 10000,
    });
  });

  it("returns the domain's default multiplier when a tariff multiplier is invalid", async () => {
    const { service } = setup({ ...tariff, volumetricMultiplier: 0 });
    expect(await service.computeServerPricing(master)).toMatchObject({ volumetricMultiplier: 250 });
  });

  it("propagates repository errors rather than treating failures as missing tariffs", async () => {
    const { repository, service } = setup();
    const error = new Error("Repository unavailable");
    repository.findActiveTariffById.mockRejectedValue(error);
    await expect(service.computeServerPricing({ ...master, tariffId: 7 })).rejects.toBe(error);
    expect(repository.findMatchingActiveTariff).not.toHaveBeenCalled();
    repository.findMatchingActiveTariff.mockRejectedValue(error);
    await expect(service.computeServerPricing(master)).rejects.toBe(error);
  });
});
