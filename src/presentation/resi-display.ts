import type { PricingMethod } from "@/domain/pricing";

/**
 * Master Resi stat visibility (fix, 2026-09-28).
 *
 * Every tariff chooses ONE pricing method (see `Tariff.pricingMethod` in
 * prisma/schema.prisma): /kg, /koli, or /cubic. Before this fix, the Master
 * Resi always showed all four stat cells (Jumlah, Aktual kg, Chargeable kg,
 * Volume m³) no matter which method the customer was actually billed by —
 * a /koli customer's resi showed a chargeable weight they're never charged
 * for, which is confusing on the printed slip.
 *
 * Rule (as specified): the package count ("Jumlah" / colly count) is ALWAYS
 * shown — how many pieces are in the shipment matters for handling no
 * matter how it's billed. Weight and volume are shown only when they're the
 * thing actually being billed:
 *   - PER_KG / PER_KG_SIMPLE → show weight (Aktual + Chargeable), hide volume
 *   - PER_CUBIC → show volume, hide weight
 *   - PER_KOLI  → hide both — the koli count itself IS the billing unit,
 *                 already covered by the always-shown Jumlah cell
 *
 * The same rule applies to B2C promo tariffs; legacy B2C rows default to
 * /kg when no method was stored.
 */
export interface ResiStatVisibility {
  showWeight: boolean;
  showVolume: boolean;
}

export function resiStatVisibility(method: PricingMethod): ResiStatVisibility {
  return {
    showWeight: method === "PER_KG" || method === "PER_KG_SIMPLE",
    showVolume: method === "PER_CUBIC",
  };
}

/** Short, printable label for the B2B pricing-method mark on the Master Resi. */
export function resiPricingMethodLabel(method: PricingMethod): string {
  switch (method) {
    case "PER_KG_SIMPLE":
      return "/ KG Aktual";
    case "PER_KOLI":
      return "/ Koli";
    case "PER_CUBIC":
      return "/ Cubic (m\u00b3)";
    default:
      return "/ KG";
  }
}
