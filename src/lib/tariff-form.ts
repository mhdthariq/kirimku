import type { PricingMethod } from "@/lib/client-api";

/**
 * Shared tariff form logic (2026-09-28). Used by the Tariff page AND by the
 * B2B tariff panel beside the "Tambah Customer" dialog, so both build the
 * exact same payload — and it's pure, so it's unit-tested.
 */

export type TariffTab = "b2c" | "b2b";

export interface TariffFormState {
  name: string;
  origin: string;
  destination: string;
  /** Only meaningful for B2B tariffs — the customer this tariff is tied to. */
  customerId: string;
  pricingMethod: PricingMethod;
  ratePerKg: string;
  ratePerKoli: string;
  ratePerCubic: string;
  minChargeableKg: string;
  volumetricMultiplier: string;
  roundingMode: string;
  roundingUnitKg: string;
  minChargeableKoli: string;
  minChargeableM3: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export function emptyTariffForm(today: string = new Date().toISOString().slice(0, 10)): TariffFormState {
  return {
    name: "",
    origin: "",
    destination: "",
    customerId: "",
    pricingMethod: "PER_KG",
    ratePerKg: "",
    ratePerKoli: "",
    ratePerCubic: "",
    minChargeableKg: "1",
    volumetricMultiplier: "250",
    roundingMode: "UP",
    roundingUnitKg: "0.5",
    minChargeableKoli: "1",
    minChargeableM3: "0",
    effectiveFrom: today,
    effectiveTo: "",
  };
}

export interface TariffFieldVisibility {
  /** Min kg, multiplier, rounding mode and rounding unit — only /kg uses them. */
  showKgRules: boolean;
  showRatePerKg: boolean;
  showRatePerKoli: boolean;
  showRatePerCubic: boolean;
  showMinKoli: boolean;
  showMinM3: boolean;
  /** B2B only — B2C is always /kg, so no method choice. */
  showMethodChoice: boolean;
  showCustomer: boolean;
}

/**
 * Which fields make sense for a tariff. The kg-specific rules (Min Kg,
 * Multiplier, Pembulatan, Satuan) are hidden for /koli and /cubic because
 * those methods never look at weight — showing them was wrong.
 */
export function tariffFieldVisibility(tab: TariffTab, method: PricingMethod): TariffFieldVisibility {
  const effective: PricingMethod = tab === "b2b" ? method : "PER_KG";
  return {
    showKgRules: effective === "PER_KG",
    showRatePerKg: effective === "PER_KG",
    showRatePerKoli: effective === "PER_KOLI",
    showRatePerCubic: effective === "PER_CUBIC",
    showMinKoli: effective === "PER_KOLI",
    showMinM3: effective === "PER_CUBIC",
    showMethodChoice: tab === "b2b",
    showCustomer: tab === "b2b",
  };
}

const num = (v: string): number => Number(v);

/** Build the API payload. Fields a method doesn't use are sent as safe defaults. */
export function buildTariffPayload(tab: TariffTab, form: TariffFormState) {
  const method: PricingMethod = tab === "b2b" ? form.pricingMethod : "PER_KG";
  const isKg = method === "PER_KG";
  return {
    name: form.name.trim() || null,
    origin: form.origin.trim(),
    destination: form.destination.trim(),
    customerType: tab,
    customerId: tab === "b2b" && form.customerId ? Number(form.customerId) : null,
    pricingMethod: method,
    ratePerKg: isKg ? num(form.ratePerKg) || 0 : 0,
    ratePerKoli: method === "PER_KOLI" ? num(form.ratePerKoli) : null,
    ratePerCubic: method === "PER_CUBIC" ? num(form.ratePerCubic) : null,
    minChargeableKoli: method === "PER_KOLI" ? num(form.minChargeableKoli) || 1 : 1,
    minChargeableM3: method === "PER_CUBIC" ? num(form.minChargeableM3) || 0 : 0,
    // kg-only rules: real values for /kg, neutral defaults otherwise
    minChargeableKg: isKg ? num(form.minChargeableKg) || 1 : 1,
    volumetricMultiplier: isKg ? num(form.volumetricMultiplier) || 250 : 250,
    roundingMode: isKg ? form.roundingMode : "UP",
    roundingUnitKg: isKg ? num(form.roundingUnitKg) || 0.5 : 0.5,
    effectiveFrom: form.effectiveFrom,
    effectiveTo: form.effectiveTo === "" ? null : form.effectiveTo,
  };
}

/** Client-side validation message for a B2B tariff panel/form, or null when OK. */
export function validateTariffForm(tab: TariffTab, form: TariffFormState): string | null {
  if (!form.origin.trim() || !form.destination.trim()) return "Kota asal dan tujuan wajib diisi.";
  if (tab === "b2b" && !form.customerId) return "Pilih customer B2B untuk tarif ini.";
  const method = tab === "b2b" ? form.pricingMethod : "PER_KG";
  if (method === "PER_KG" && !(num(form.ratePerKg) > 0)) return "Tarif per kg wajib diisi.";
  if (method === "PER_KOLI" && !(num(form.ratePerKoli) > 0)) return "Tarif per koli wajib diisi.";
  if (method === "PER_CUBIC" && !(num(form.ratePerCubic) > 0)) return "Tarif per m³ wajib diisi.";
  return null;
}

export interface TariffScopeInfo {
  id: number;
  customerType: string | null;
  customerId?: number | null;
}

/**
 * Which tariffs a customer may pick when creating a shipment:
 *  - B2B customer → ONLY tariffs tied to that customer.
 *  - B2C customer → B2C tariffs and generic ("semua tipe") tariffs, never B2B.
 *  - no customer picked yet → nothing customer-specific (B2B tariffs hidden).
 */
export function tariffsForCustomer<T extends TariffScopeInfo>(
  tariffs: T[],
  customer: { id: number; type: string } | null,
): T[] {
  return tariffs.filter((t) => {
    if (t.customerType === "b2b") return !!customer && customer.type === "b2b" && t.customerId === customer.id;
    if (!customer) return true;
    return customer.type === "b2b" ? false : !t.customerType || t.customerType === customer.type;
  });
}

/** Label used in dropdowns/tables: "Reguler · A → B" or just "A → B" for legacy unnamed tariffs. */
export function tariffLabel(t: { name?: string | null; origin: string; destination: string }): string {
  const lane = `${t.origin} → ${t.destination}`;
  return t.name ? `${t.name} · ${lane}` : lane;
}

/** Which tab a stored tariff belongs to. Legacy generic ("semua tipe") tariffs live under B2C. */
export function tariffTabOf(t: { customerType: string | null }): TariffTab {
  return t.customerType === "b2b" ? "b2b" : "b2c";
}

/** Fill the form from a stored tariff (edit dialog). */
export function tariffToForm(t: {
  name?: string | null;
  origin: string;
  destination: string;
  customerType: string | null;
  customerId?: number | null;
  pricingMethod?: PricingMethod | null;
  ratePerKg: number;
  ratePerKoli?: number | null;
  ratePerCubic?: number | null;
  minChargeableKg: number;
  volumetricMultiplier: number;
  roundingMode: string;
  roundingUnitKg: number;
  minChargeableKoli?: number | null;
  minChargeableM3?: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}): TariffFormState {
  const b2b = t.customerType === "b2b";
  return {
    name: t.name ?? "",
    origin: t.origin,
    destination: t.destination,
    customerId: b2b && t.customerId != null ? String(t.customerId) : "",
    pricingMethod: b2b ? t.pricingMethod ?? "PER_KG" : "PER_KG",
    ratePerKg: String(t.ratePerKg),
    ratePerKoli: t.ratePerKoli != null ? String(t.ratePerKoli) : "",
    ratePerCubic: t.ratePerCubic != null ? String(t.ratePerCubic) : "",
    minChargeableKg: String(t.minChargeableKg),
    volumetricMultiplier: String(t.volumetricMultiplier),
    roundingMode: t.roundingMode,
    roundingUnitKg: String(t.roundingUnitKg),
    minChargeableKoli: String(t.minChargeableKoli ?? 1),
    minChargeableM3: String(t.minChargeableM3 ?? 0),
    effectiveFrom: t.effectiveFrom.slice(0, 10),
    effectiveTo: t.effectiveTo ? t.effectiveTo.slice(0, 10) : "",
  };
}
