"use client";

import { Boxes, Package, Ruler, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TariffFormFields } from "@/components/app/tariff-form-fields";
import { cn } from "@/lib/utils";
import type { PricingMethod } from "@/lib/client-api";
import type { TariffFormState } from "@/lib/tariff-form";

const METHODS: { value: PricingMethod; label: string; hint: string; icon: typeof Scale }[] = [
  { value: "PER_KG", label: "Per kg", hint: "Berat / volumetrik", icon: Scale },
  { value: "PER_KOLI", label: "Per koli", hint: "Jumlah paket", icon: Package },
  { value: "PER_CUBIC", label: "Per cubic", hint: "Volume m³", icon: Ruler },
];

/**
 * The window beside "Tambah Customer" when the type is B2B: pick one of the
 * 3 pricing methods and set the tariff right away, or skip it and add the
 * tariff later in the Tarif page (B2B tab). The tariff is created after the
 * customer and is automatically tied to them.
 */
export function CustomerTariffPanel({
  form,
  setForm,
  busy,
  skipped,
  onSkipChange,
}: {
  form: TariffFormState;
  setForm: (next: TariffFormState) => void;
  busy: boolean;
  skipped: boolean;
  onSkipChange: (skipped: boolean) => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Boxes className="h-4 w-4 text-primary" /> Tarif B2B
          </p>
          <p className="text-xs text-muted-foreground">
            Opsional - tarif ini otomatis terikat ke customer yang sedang dibuat.
          </p>
        </div>
        <Button type="button" variant={skipped ? "default" : "outline"} size="sm" onClick={() => onSkipChange(!skipped)} disabled={busy}>
          {skipped ? "Isi tarif" : "Lewati"}
        </Button>
      </div>

      {skipped ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Tarif dilewati. Isi nanti di menu <span className="font-semibold">Tarif → tab B2B</span> - sebelum itu customer ini belum bisa dipakai membuat shipment.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Metode harga">
            {METHODS.map((m) => {
              const active = form.pricingMethod === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => setForm({ ...form, pricingMethod: m.value })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-colors",
                    active ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-accent",
                  )}
                >
                  <m.icon className="h-4 w-4" />
                  <span className="text-xs font-semibold">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">{m.hint}</span>
                </button>
              );
            })}
          </div>
          <TariffFormFields tab="b2b" form={form} setForm={setForm} busy={busy} hideCustomer hideMethodChoice idPrefix="ct" />
        </>
      )}
    </div>
  );
}
