import { describe, expect, it } from "vitest";
import { computePricing, normalizePricingMethod, volumetricKgForDetail, type TariffLike, type PricedDetailInput } from "@/domain/pricing";

function tariff(overrides: Partial<TariffLike> = {}): TariffLike {
  return {
    ratePerKg: 4500,
    minChargeableKg: 1,
    volumetricMultiplier: 250,
    roundingMode: "UP",
    roundingUnitKg: 0.5,
    pricingMethod: "PER_KG",
    ratePerKoli: null,
    ratePerCubic: null,
    minChargeableKoli: 1,
    minChargeableM3: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<PricedDetailInput> = {}): PricedDetailInput {
  return { actualWeightKg: 1, lengthCm: 0, widthCm: 0, heightCm: 0, volumeM3: null, ...overrides };
}

describe("normalizePricingMethod", () => {
  it("passes through the two B2B methods", () => {
    expect(normalizePricingMethod("PER_KOLI")).toBe("PER_KOLI");
    expect(normalizePricingMethod("PER_CUBIC")).toBe("PER_CUBIC");
  });

  it("defaults anything else to PER_KG (legacy rows, B2C, garbage input)", () => {
    expect(normalizePricingMethod("PER_KG")).toBe("PER_KG");
    expect(normalizePricingMethod(null)).toBe("PER_KG");
    expect(normalizePricingMethod(undefined)).toBe("PER_KG");
    expect(normalizePricingMethod("something-else")).toBe("PER_KG");
  });
});

describe("computePricing — PER_KG (B2C and default B2B)", () => {
  it("charges actual weight when it exceeds volumetric weight", () => {
    // 10kg actual, small box → volumetric weight is negligible
    const r = computePricing([detail({ actualWeightKg: 10, lengthCm: 10, widthCm: 10, heightCm: 10 })], tariff());
    expect(r.method).toBe("PER_KG");
    expect(r.actualKg).toBe(10);
    expect(r.volumetricKg).toBeCloseTo((10 * 10 * 10) / 1_000_000 * 250, 5); // 0.25 kg
    expect(r.chargeableKg).toBe(10); // rounds up to nearest 0.5, already whole
    expect(r.price).toBe(10 * 4500);
  });

  it("charges volumetric weight when it exceeds actual weight", () => {
    // big light box: 100x100x100 cm = 1 m³, multiplier 250 → 250 kg volumetric vs 2 kg actual
    const r = computePricing([detail({ actualWeightKg: 2, lengthCm: 100, widthCm: 100, heightCm: 100 })], tariff());
    expect(r.volumetricKg).toBeCloseTo(250, 5);
    expect(r.chargeableKg).toBe(250);
    expect(r.price).toBe(250 * 4500);
  });

  it("uses volumeM3 directly when set, instead of L×W×H", () => {
    const withDims = detail({ actualWeightKg: 1, lengthCm: 100, widthCm: 100, heightCm: 100 }); // 1 m3 → 250kg volumetric
    const withVolume = detail({ actualWeightKg: 1, lengthCm: 999, widthCm: 999, heightCm: 999, volumeM3: 1 }); // dims ignored, same 1 m3
    const a = computePricing([withDims], tariff());
    const b = computePricing([withVolume], tariff());
    expect(b.volumetricKg).toBeCloseTo(a.volumetricKg, 5);
    expect(volumetricKgForDetail(withVolume, 250)).toBeCloseTo(250, 5);
  });

  it("floors chargeable weight at minChargeableKg", () => {
    const r = computePricing([detail({ actualWeightKg: 0.1 })], tariff({ minChargeableKg: 3 }));
    expect(r.chargeableKg).toBe(3);
    expect(r.price).toBe(3 * 4500);
  });

  it("rounds UP to the rounding unit by default", () => {
    const r = computePricing([detail({ actualWeightKg: 3.1 })], tariff({ roundingUnitKg: 0.5, roundingMode: "UP" }));
    expect(r.chargeableKg).toBe(3.5); // 3.1 rounds up to next 0.5 step
  });

  it("rounds to NEAREST rounding unit when configured", () => {
    const r = computePricing([detail({ actualWeightKg: 3.2 })], tariff({ roundingUnitKg: 0.5, roundingMode: "NEAREST" }));
    expect(r.chargeableKg).toBe(3); // 3.2 → nearest 0.5 is 3.0
  });

  it("sums multiple packages before applying the floor/rounding once", () => {
    const r = computePricing(
      [detail({ actualWeightKg: 1 }), detail({ actualWeightKg: 1.2 }), detail({ actualWeightKg: 0.3 })],
      tariff(),
    );
    expect(r.actualKg).toBeCloseTo(2.5, 5);
    expect(r.koliCount).toBe(3);
  });
});

describe("computePricing — B2B /kg is simple (entered weight × rate)", () => {
  const b2bKg = (over: Partial<TariffLike> = {}) => tariff({ customerType: "b2b", ratePerKg: 8000, ...over });

  it("bills the weight entered with NO rounding (0.3 kg is not rounded up to 0.5)", () => {
    const r = computePricing([detail({ actualWeightKg: 3.3 })], b2bKg({ minChargeableKg: 1, roundingUnitKg: 2, roundingMode: "UP" }));
    expect(r.simpleKg).toBe(true);
    expect(r.chargeableKg).toBeCloseTo(3.3, 5);
    expect(r.price).toBe(Math.round(3.3 * 8000));
  });

  it("still applies the tariff's Min kg", () => {
    const r = computePricing([detail({ actualWeightKg: 0.3 })], b2bKg({ minChargeableKg: 5 }));
    expect(r.chargeableKg).toBe(5);
    expect(r.price).toBe(5 * 8000);
  });

  it("ignores volumetric weight completely", () => {
    // 1 m³ box at multiplier 250 = 250 kg volumetric, but only 2 kg was entered
    const r = computePricing([detail({ actualWeightKg: 2, lengthCm: 100, widthCm: 100, heightCm: 100 })], b2bKg({ minChargeableKg: 1 }));
    expect(r.chargeableKg).toBe(2);
    expect(r.price).toBe(2 * 8000);
  });

  it("sums the weight of all packages", () => {
    const r = computePricing([detail({ actualWeightKg: 1.25 }), detail({ actualWeightKg: 2.5 })], b2bKg());
    expect(r.chargeableKg).toBeCloseTo(3.75, 5);
    expect(r.price).toBe(3.75 * 8000);
  });

  it("B2C /kg is unchanged (still volumetric + min + rounding)", () => {
    const r = computePricing([detail({ actualWeightKg: 0.3 })], tariff({ customerType: "b2c", minChargeableKg: 1 }));
    expect(r.simpleKg).toBe(false);
    expect(r.chargeableKg).toBe(1);
  });
});

describe("computePricing — PER_KOLI (B2B)", () => {
  it("charges per package (koli), ignoring weight/volume entirely", () => {
    const details = [detail({ actualWeightKg: 999 }), detail({ actualWeightKg: 0.001 })]; // weight shouldn't matter
    const r = computePricing(details, tariff({ pricingMethod: "PER_KOLI", ratePerKoli: 25_000 }));
    expect(r.method).toBe("PER_KOLI");
    expect(r.chargeableKoli).toBe(2);
    expect(r.rateApplied).toBe(25_000);
    expect(r.price).toBe(2 * 25_000);
  });

  it("floors at minChargeableKoli even with fewer packages", () => {
    const r = computePricing([detail()], tariff({ pricingMethod: "PER_KOLI", ratePerKoli: 25_000, minChargeableKoli: 5 }));
    expect(r.chargeableKoli).toBe(5);
    expect(r.price).toBe(5 * 25_000);
  });

  it("prices to 0 when ratePerKoli is missing (fail-safe, not a crash)", () => {
    const r = computePricing([detail()], tariff({ pricingMethod: "PER_KOLI", ratePerKoli: null }));
    expect(r.price).toBe(0);
  });
});

describe("computePricing — PER_CUBIC (B2B)", () => {
  it("charges per m³ of total volume, ignoring weight", () => {
    // two 1x1x1 m boxes = 2 m3 total
    const details = [
      detail({ actualWeightKg: 1, lengthCm: 100, widthCm: 100, heightCm: 100 }),
      detail({ actualWeightKg: 1, lengthCm: 100, widthCm: 100, heightCm: 100 }),
    ];
    const r = computePricing(details, tariff({ pricingMethod: "PER_CUBIC", ratePerCubic: 850_000 }));
    expect(r.method).toBe("PER_CUBIC");
    expect(r.totalVolumeM3).toBeCloseTo(2, 5);
    expect(r.chargeableVolumeM3).toBeCloseTo(2, 5);
    expect(r.price).toBe(Math.round(2 * 850_000));
  });

  it("uses volumeM3 directly when provided instead of L×W×H", () => {
    const r = computePricing([detail({ volumeM3: 1.5 })], tariff({ pricingMethod: "PER_CUBIC", ratePerCubic: 800_000 }));
    expect(r.totalVolumeM3).toBeCloseTo(1.5, 5);
    expect(r.price).toBe(Math.round(1.5 * 800_000));
  });

  it("floors at minChargeableM3 when volume is smaller", () => {
    const r = computePricing([detail({ volumeM3: 0.05 })], tariff({ pricingMethod: "PER_CUBIC", ratePerCubic: 800_000, minChargeableM3: 0.2 }));
    expect(r.chargeableVolumeM3).toBeCloseTo(0.2, 5);
    expect(r.price).toBe(Math.round(0.2 * 800_000));
  });

  it("applies no floor when minChargeableM3 is 0 (default)", () => {
    const r = computePricing([detail({ volumeM3: 0.01 })], tariff({ pricingMethod: "PER_CUBIC", ratePerCubic: 800_000 }));
    expect(r.chargeableVolumeM3).toBeCloseTo(0.01, 5);
  });
});

describe("computePricing — B2C is always PER_KG in practice", () => {
  it("a tariff with no pricingMethod set (legacy row) behaves exactly like PER_KG", () => {
    const legacyTariff = tariff();
    delete (legacyTariff as { pricingMethod?: string }).pricingMethod;
    const r = computePricing([detail({ actualWeightKg: 5 })], legacyTariff);
    expect(r.method).toBe("PER_KG");
    expect(r.price).toBe(5 * 4500);
  });
});
