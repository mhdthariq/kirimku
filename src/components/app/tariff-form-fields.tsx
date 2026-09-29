"use client";

import { Field, FormSelect, Input, NumberInput } from "@/components/app/form-parts";
import { tariffFieldVisibility, type TariffFormState, type TariffTab } from "@/lib/tariff-form";
import type { PricingMethod } from "@/lib/client-api";

const METHOD_OPTIONS: { value: PricingMethod; label: string }[] = [
  { value: "PER_KG", label: "Per kg" },
  { value: "PER_KOLI", label: "Per koli" },
  { value: "PER_CUBIC", label: "Per cubic (m³)" },
];

/**
 * The tariff form body, shared by the Tarif page dialog and the B2B tariff
 * panel next to "Tambah Customer" so both stay identical. Which fields show
 * is decided by `tariffFieldVisibility` (pure + tested): /koli and /cubic
 * never show the kg rules (Min kg, Multiplier, Pembulatan, Satuan).
 */
export function TariffFormFields({
  tab,
  form,
  setForm,
  busy,
  customerOptions,
  hideCustomer = false,
  hideMethodChoice = false,
  idPrefix = "tf",
}: {
  tab: TariffTab;
  form: TariffFormState;
  setForm: (next: TariffFormState) => void;
  busy: boolean;
  customerOptions?: { value: string; label: string }[];
  /** Hide the customer picker when the customer is already known (customer panel). */
  hideCustomer?: boolean;
  /** Hide the method dropdown when the caller renders its own method picker (customer panel). */
  hideMethodChoice?: boolean;
  idPrefix?: string;
}) {
  const v = tariffFieldVisibility(tab, form.pricingMethod);
  const set = (patch: Partial<TariffFormState>) => setForm({ ...form, ...patch });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nama Tarif" htmlFor={`${idPrefix}-name`} hint="Beda nama = boleh koridor yang sama. Contoh: Reguler, Express." className="sm:col-span-2">
        <Input id={`${idPrefix}-name`} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Reguler" disabled={busy} />
      </Field>

      {v.showCustomer && !hideCustomer && (
        <Field label="Customer B2B" htmlFor={`${idPrefix}-customer`} hint="Tarif ini hanya muncul untuk customer ini saat membuat shipment." className="sm:col-span-2">
          <FormSelect
            value={form.customerId}
            onValueChange={(value) => set({ customerId: value })}
            placeholder="Pilih customer B2B…"
            options={customerOptions ?? []}
            disabled={busy}
          />
        </Field>
      )}

      <Field label="Kota Asal" htmlFor={`${idPrefix}-origin`}>
        <Input id={`${idPrefix}-origin`} value={form.origin} onChange={(e) => set({ origin: e.target.value })} placeholder="Jakarta Pusat" required disabled={busy} />
      </Field>
      <Field label="Kota Tujuan" htmlFor={`${idPrefix}-destination`}>
        <Input id={`${idPrefix}-destination`} value={form.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="Bandung" required disabled={busy} />
      </Field>

      {v.showMethodChoice && !hideMethodChoice && (
        <Field label="Metode Harga" htmlFor={`${idPrefix}-method`} hint="Pilih satu: /kg, /koli, atau /cubic." className="sm:col-span-2">
          <FormSelect value={form.pricingMethod} onValueChange={(value) => set({ pricingMethod: value as PricingMethod })} options={METHOD_OPTIONS} disabled={busy} />
        </Field>
      )}

      {v.showRatePerKg && (
        <Field label="Tarif per kg (Rp)" htmlFor={`${idPrefix}-rate`}>
          <NumberInput id={`${idPrefix}-rate`} value={form.ratePerKg} onChange={(e) => set({ ratePerKg: e.target.value })} placeholder="4500" required disabled={busy} />
        </Field>
      )}
      {v.showRatePerKoli && (
        <>
          <Field label="Tarif per koli (Rp)" htmlFor={`${idPrefix}-rate-koli`}>
            <NumberInput id={`${idPrefix}-rate-koli`} value={form.ratePerKoli} onChange={(e) => set({ ratePerKoli: e.target.value })} placeholder="25000" required disabled={busy} />
          </Field>
          {v.showMinKoli && (
            <Field label="Min. koli" htmlFor={`${idPrefix}-min-koli`} hint="Ditagih minimal sekian koli">
              <NumberInput id={`${idPrefix}-min-koli`} value={form.minChargeableKoli} onChange={(e) => set({ minChargeableKoli: e.target.value })} disabled={busy} />
            </Field>
          )}
        </>
      )}
      {v.showRatePerCubic && (
        <>
          <Field label="Tarif per m³ (Rp)" htmlFor={`${idPrefix}-rate-cubic`}>
            <NumberInput id={`${idPrefix}-rate-cubic`} value={form.ratePerCubic} onChange={(e) => set({ ratePerCubic: e.target.value })} placeholder="850000" required disabled={busy} />
          </Field>
          {v.showMinM3 && (
            <Field label="Min. m³" htmlFor={`${idPrefix}-min-cubic`} hint="0 = tanpa batas minimum">
              <NumberInput id={`${idPrefix}-min-cubic`} value={form.minChargeableM3} onChange={(e) => set({ minChargeableM3: e.target.value })} disabled={busy} />
            </Field>
          )}
        </>
      )}

      {/* kg-only rules — hidden for /koli and /cubic (they never look at weight) */}
      {v.showKgRules && (
        <>
          <Field label="Min. kg" htmlFor={`${idPrefix}-min`}>
            <NumberInput id={`${idPrefix}-min`} value={form.minChargeableKg} onChange={(e) => set({ minChargeableKg: e.target.value })} disabled={busy} />
          </Field>
          <Field label="Multiplier (kg/m³)" htmlFor={`${idPrefix}-multiplier`} hint="volumetrik = L×W×H/1.000.000 × ini">
            <NumberInput id={`${idPrefix}-multiplier`} value={form.volumetricMultiplier} onChange={(e) => set({ volumetricMultiplier: e.target.value })} placeholder="250" disabled={busy} />
          </Field>
          <Field label="Pembulatan" htmlFor={`${idPrefix}-rounding`}>
            <FormSelect
              value={form.roundingMode}
              onValueChange={(value) => set({ roundingMode: value })}
              options={[{ value: "UP", label: "Round up" }, { value: "NEAREST", label: "Nearest" }]}
              disabled={busy}
            />
          </Field>
          <Field label="Satuan (kg)" htmlFor={`${idPrefix}-unit`}>
            <NumberInput id={`${idPrefix}-unit`} value={form.roundingUnitKg} onChange={(e) => set({ roundingUnitKg: e.target.value })} disabled={busy} />
          </Field>
        </>
      )}

      <Field label="Berlaku dari" htmlFor={`${idPrefix}-from`}>
        <Input id={`${idPrefix}-from`} type="date" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} required disabled={busy} />
      </Field>
      <Field label="Berlaku sampai" htmlFor={`${idPrefix}-to`} hint="Kosongkan = tanpa batas">
        <Input id={`${idPrefix}-to`} type="date" value={form.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} disabled={busy} />
      </Field>
    </div>
  );
}
