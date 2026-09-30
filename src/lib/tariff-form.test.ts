import { describe, expect, it } from "vitest";
import {
  buildTariffPayload,
  emptyTariffForm,
  tariffFieldVisibility,
  tariffLabel,
  tariffTabOf,
  tariffToForm,
  tariffsForCustomer,
  validateTariffForm,
} from "./tariff-form";

const form = (over = {}) => ({ ...emptyTariffForm("2026-09-28"), origin: "Medan", destination: "Jakarta", ...over });

describe("tariffFieldVisibility", () => {
  it("B2C: /kg only — kg rules shown, no method choice, no customer", () => {
    const v = tariffFieldVisibility("b2c", "PER_KOLI"); // method ignored for B2C
    expect(v).toMatchObject({ showKgRules: true, showRatePerKg: true, showMethodChoice: false, showCustomer: false, showRatePerKoli: false });
  });
  it("B2B /kg: rate + Min kg only — NO Multiplier / Pembulatan / Satuan", () => {
    expect(tariffFieldVisibility("b2b", "PER_KG")).toMatchObject({ showKgRules: false, showMinKg: true, showRatePerKg: true, showMethodChoice: true, showCustomer: true });
  });
  it("B2B /koli: NO Min kg / Multiplier / Pembulatan / Satuan", () => {
    const v = tariffFieldVisibility("b2b", "PER_KOLI");
    expect(v.showKgRules).toBe(false);
    expect(v.showMinKg).toBe(false);
    expect(v.showRatePerKg).toBe(false);
    expect(v).toMatchObject({ showRatePerKoli: true, showMinKoli: true, showRatePerCubic: false });
  });
  it("B2B /cubic: NO kg rules either", () => {
    const v = tariffFieldVisibility("b2b", "PER_CUBIC");
    expect(v.showKgRules).toBe(false);
    expect(v).toMatchObject({ showRatePerCubic: true, showMinM3: true, showRatePerKoli: false });
  });
});

describe("buildTariffPayload", () => {
  it("B2B /koli sends neutral kg defaults, not whatever was typed", () => {
    const p = buildTariffPayload("b2b", form({ customerId: "7", pricingMethod: "PER_KOLI", ratePerKoli: "25000", minChargeableKg: "99", volumetricMultiplier: "999", roundingMode: "NEAREST", roundingUnitKg: "5" }));
    expect(p).toMatchObject({ customerType: "b2b", customerId: 7, pricingMethod: "PER_KOLI", ratePerKoli: 25000, ratePerCubic: null, ratePerKg: 0, minChargeableKg: 1, volumetricMultiplier: 250, roundingMode: "UP", roundingUnitKg: 0.5 });
  });
  it("B2B /cubic sends ratePerCubic and min m³", () => {
    const p = buildTariffPayload("b2b", form({ customerId: "7", pricingMethod: "PER_CUBIC", ratePerCubic: "850000", minChargeableM3: "0.2" }));
    expect(p).toMatchObject({ ratePerCubic: 850000, minChargeableM3: 0.2, ratePerKoli: null, ratePerKg: 0 });
  });
  it("B2B /kg keeps Min kg but sends neutral multiplier/rounding defaults", () => {
    const p = buildTariffPayload("b2b", form({ customerId: "7", pricingMethod: "PER_KG", ratePerKg: "8000", minChargeableKg: "5", volumetricMultiplier: "400", roundingMode: "NEAREST", roundingUnitKg: "2" }));
    expect(p).toMatchObject({ pricingMethod: "PER_KG", ratePerKg: 8000, minChargeableKg: 5, volumetricMultiplier: 250, roundingMode: "UP", roundingUnitKg: 0.5 });
  });
  it("B2C is always /kg, has no customer, keeps kg rules", () => {
    const p = buildTariffPayload("b2c", form({ customerId: "7", pricingMethod: "PER_KOLI", ratePerKg: "4500", minChargeableKg: "3" }));
    expect(p).toMatchObject({ customerType: "b2c", customerId: null, pricingMethod: "PER_KG", ratePerKg: 4500, minChargeableKg: 3 });
  });
  it("trims the name and turns blank into null", () => {
    expect(buildTariffPayload("b2c", form({ name: "  Express ", ratePerKg: "1" })).name).toBe("Express");
    expect(buildTariffPayload("b2c", form({ name: "   ", ratePerKg: "1" })).name).toBeNull();
  });
});

describe("validateTariffForm", () => {
  it("requires a customer for B2B", () => {
    expect(validateTariffForm("b2b", form({ ratePerKg: "1" }))).toMatch(/customer/i);
  });
  it("requires the rate of the chosen method", () => {
    expect(validateTariffForm("b2b", form({ customerId: "1", pricingMethod: "PER_KOLI" }))).toMatch(/koli/i);
    expect(validateTariffForm("b2b", form({ customerId: "1", pricingMethod: "PER_CUBIC" }))).toMatch(/m³/);
    expect(validateTariffForm("b2b", form({ customerId: "1", pricingMethod: "PER_KOLI", ratePerKoli: "100" }))).toBeNull();
  });
  it("does not need a customer for B2C", () => {
    expect(validateTariffForm("b2c", form({ ratePerKg: "4500" }))).toBeNull();
  });
});

describe("tariffsForCustomer — B2B customers only see their own tariffs", () => {
  const tariffs = [
    { id: 1, customerType: "b2c", customerId: null },
    { id: 2, customerType: null, customerId: null },
    { id: 3, customerType: "b2b", customerId: 10 },
    { id: 4, customerType: "b2b", customerId: 11 },
    { id: 5, customerType: "b2b", customerId: null }, // legacy, untied
  ];
  const ids = (c: { id: number; type: string } | null) => tariffsForCustomer(tariffs, c).map((t) => t.id);

  it("B2B customer 10 sees only tariff 3", () => expect(ids({ id: 10, type: "b2b" })).toEqual([3]));
  it("B2B customer 11 sees only tariff 4", () => expect(ids({ id: 11, type: "b2b" })).toEqual([4]));
  it("B2B customer with none tied sees nothing", () => expect(ids({ id: 99, type: "b2b" })).toEqual([]));
  it("B2C customer sees B2C + generic, never B2B", () => expect(ids({ id: 1, type: "b2c" })).toEqual([1, 2]));
  it("no customer picked: no B2B tariffs leak", () => expect(ids(null)).toEqual([1, 2]));
});

describe("naming and tabs", () => {
  it("labels by name when present, else just the lane", () => {
    expect(tariffLabel({ name: "Express", origin: "A", destination: "B" })).toBe("Express · A → B");
    expect(tariffLabel({ name: null, origin: "A", destination: "B" })).toBe("A → B");
  });
  it("legacy generic tariffs live under the B2C tab", () => {
    expect(tariffTabOf({ customerType: null })).toBe("b2c");
    expect(tariffTabOf({ customerType: "b2b" })).toBe("b2b");
  });
  it("tariffToForm round-trips a B2B koli tariff", () => {
    const f = tariffToForm({ name: "Reguler", origin: "A", destination: "B", customerType: "b2b", customerId: 5, pricingMethod: "PER_KOLI", ratePerKg: 0, ratePerKoli: 25000, minChargeableKg: 1, volumetricMultiplier: 250, roundingMode: "UP", roundingUnitKg: 0.5, minChargeableKoli: 2, effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: null });
    expect(f).toMatchObject({ name: "Reguler", customerId: "5", pricingMethod: "PER_KOLI", ratePerKoli: "25000", minChargeableKoli: "2", effectiveFrom: "2026-09-01" });
  });
});
