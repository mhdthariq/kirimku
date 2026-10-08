import { describe, expect, it } from "vitest";
import { resiStatVisibility, resiPricingMethodLabel } from "@/presentation/resi-display";

describe("resiStatVisibility", () => {
  it("PER_KG: shows weight, hides volume", () => {
    expect(resiStatVisibility("PER_KG")).toEqual({ showWeight: true, showVolume: false });
  });

  it("PER_CUBIC: shows volume, hides weight", () => {
    expect(resiStatVisibility("PER_CUBIC")).toEqual({ showWeight: false, showVolume: true });
  });

  it("PER_KOLI: hides both — the always-shown Jumlah cell IS the billing unit", () => {
    expect(resiStatVisibility("PER_KOLI")).toEqual({ showWeight: false, showVolume: false });
  });

  it("never hides both weight AND volume for PER_KG or PER_CUBIC (at least one billed metric always shows)", () => {
    expect(Object.values(resiStatVisibility("PER_KG")).some(Boolean)).toBe(true);
    expect(Object.values(resiStatVisibility("PER_CUBIC")).some(Boolean)).toBe(true);
  });
});

describe("resiPricingMethodLabel", () => {
  it("labels each method distinctly and printably", () => {
    expect(resiPricingMethodLabel("PER_KG")).toBe("/ KG");
    expect(resiPricingMethodLabel("PER_KOLI")).toBe("/ Koli");
    expect(resiPricingMethodLabel("PER_CUBIC")).toBe("/ Cubic (m\u00b3)");
  });

  it("falls back to /KG for an unrecognized value (defensive default, matches normalizePricingMethod)", () => {
    // @ts-expect-error - deliberately passing an invalid value to check the fallback
    expect(resiPricingMethodLabel("something-else")).toBe("/ KG");
  });
});
