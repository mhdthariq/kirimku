"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Tariff } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatDate, formatNumber } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TariffForm {
  origin: string;
  destination: string;
  customerType: string;
  ratePerKg: string;
  minChargeableKg: string;
  volumetricMultiplier: string;
  roundingMode: string;
  roundingUnitKg: string;
  effectiveFrom: string;
  effectiveTo: string;
  /** B2B-only pricing method — B2C is always forced to "PER_KG" (§ below). */
  pricingMethod: "PER_KG" | "PER_KOLI" | "PER_CUBIC";
  ratePerKoli: string;
  ratePerCubic: string;
  minChargeableKoli: string;
  minChargeableM3: string;
}

const EMPTY: TariffForm = {
  origin: "",
  destination: "",
  customerType: "",
  ratePerKg: "",
  minChargeableKg: "1",
  volumetricMultiplier: "250",
  roundingMode: "UP",
  roundingUnitKg: "0.5",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  pricingMethod: "PER_KG",
  ratePerKoli: "",
  ratePerCubic: "",
  minChargeableKoli: "1",
  minChargeableM3: "0",
};

const PRICING_METHOD_LABEL: Record<string, string> = {
  PER_KG: "/ kg",
  PER_KOLI: "/ koli",
  PER_CUBIC: "/ m³ (cubic)",
};

export function TariffsPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "tariff.view"),
    create: hasPermission(user, "tariff.create"),
    update: hasPermission(user, "tariff.update"),
  };

  const { data, loading, reload } = useApiData<Tariff[]>(() => apiGet<Tariff[]>("/tariffs"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [form, setForm] = useState<TariffForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Tariff | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (t) => !q || t.origin.toLowerCase().includes(q) || t.destination.toLowerCase().includes(q) || (t.customerType ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(t: Tariff) {
    setEditing(t);
    setForm({
      origin: t.origin,
      destination: t.destination,
      customerType: t.customerType ?? "",
      ratePerKg: String(t.ratePerKg),
      minChargeableKg: String(t.minChargeableKg),
      volumetricMultiplier: String(t.volumetricMultiplier),
      roundingMode: t.roundingMode,
      roundingUnitKg: String(t.roundingUnitKg),
      effectiveFrom: t.effectiveFrom.slice(0, 10),
      effectiveTo: t.effectiveTo ? t.effectiveTo.slice(0, 10) : "",
      pricingMethod: t.customerType === "b2b" ? t.pricingMethod ?? "PER_KG" : "PER_KG",
      ratePerKoli: t.ratePerKoli != null ? String(t.ratePerKoli) : "",
      ratePerCubic: t.ratePerCubic != null ? String(t.ratePerCubic) : "",
      minChargeableKoli: String(t.minChargeableKoli ?? 1),
      minChargeableM3: String(t.minChargeableM3 ?? 0),
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const isB2b = form.customerType === "b2b";
    const payload = {
      origin: form.origin,
      destination: form.destination,
      customerType: form.customerType === "" ? null : form.customerType,
      // Only B2B may use /koli or /cubic — B2C / semua tipe is always /kg
      // (also re-enforced server-side, this just keeps the payload honest).
      pricingMethod: isB2b ? form.pricingMethod : "PER_KG",
      ratePerKg: Number(form.ratePerKg) || 0,
      ratePerKoli: isB2b && form.pricingMethod === "PER_KOLI" ? Number(form.ratePerKoli) : null,
      ratePerCubic: isB2b && form.pricingMethod === "PER_CUBIC" ? Number(form.ratePerCubic) : null,
      minChargeableKoli: Number(form.minChargeableKoli) || 1,
      minChargeableM3: Number(form.minChargeableM3) || 0,
      minChargeableKg: Number(form.minChargeableKg),
      volumetricMultiplier: Number(form.volumetricMultiplier),
      roundingMode: form.roundingMode,
      roundingUnitKg: Number(form.roundingUnitKg),
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo === "" ? null : form.effectiveTo,
    };
    const ok = await runAction(
      () => (editing ? apiPut(`/tariffs/${editing.id}`, payload) : apiPost("/tariffs", payload)),
      { success: editing ? "Tarif diperbarui." : "Tarif dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/tariffs/${target.id}`), { success: "Tarif diproses." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Tarif" subtitle="Anda tidak memiliki izin melihat tarif." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tarif"
        subtitle="B2C selalu /kg. B2B bisa /kg, /koli, atau /cubic (m³) - pilih metode saat membuat tarif."
        icon={<Tag className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Tarif
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari koridor / tipe…"
            emptyMessage="Belum ada tarif. Klik “Tambah Tarif” untuk membuat."
            columns={[
              {
                key: "lane",
                header: "Koridor",
                primary: true,
                render: (t) => (
                  <span className="font-semibold text-foreground">
                    {t.origin} → {t.destination}
                  </span>
                ),
              },
              {
                key: "type",
                header: "Tipe",
                render: (t) =>
                  t.customerType ? (
                    <span className="text-xs font-semibold uppercase text-primary">{t.customerType}</span>
                  ) : (
                    <span className="text-xs font-semibold uppercase text-muted-foreground">semua</span>
                  ),
              },
              {
                key: "rate",
                header: "Tarif",
                render: (t) => {
                  const method = t.customerType === "b2b" ? (t.pricingMethod ?? "PER_KG") : "PER_KG";
                  const rate = method === "PER_KOLI" ? t.ratePerKoli ?? 0 : method === "PER_CUBIC" ? t.ratePerCubic ?? 0 : t.ratePerKg;
                  return (
                    <span className="font-semibold">
                      Rp{rate.toLocaleString("id-ID")} <span className="font-normal text-muted-foreground">{PRICING_METHOD_LABEL[method]}</span>
                    </span>
                  );
                },
              },
              {
                key: "rules",
                header: "Aturan",
                hideOnMobile: true,
                render: (t) => {
                  const method = t.customerType === "b2b" ? (t.pricingMethod ?? "PER_KG") : "PER_KG";
                  if (method === "PER_KOLI") {
                    return <span className="text-xs text-muted-foreground">min {formatNumber(t.minChargeableKoli ?? 1, 0)} koli / shipment</span>;
                  }
                  if (method === "PER_CUBIC") {
                    return <span className="text-xs text-muted-foreground">min {formatNumber(t.minChargeableM3 ?? 0, 3)} m³ / shipment</span>;
                  }
                  return (
                    <span className="text-xs text-muted-foreground">
                      min {formatNumber(t.minChargeableKg)} kg · multiplier {formatNumber(t.volumetricMultiplier, 0)} kg/m³ ·{" "}
                      {t.roundingMode === "UP" ? "round up" : "nearest"} {formatNumber(t.roundingUnitKg)} kg
                    </span>
                  );
                },
              },
              { key: "effective", header: "Berlaku", hideOnMobile: true, render: (t) => `${formatDate(t.effectiveFrom)}${t.effectiveTo ? ` – ${formatDate(t.effectiveTo)}` : " – ∞"}` },
              { key: "status", header: "Status", render: (t) => <ActiveBadge active={t.isActive} /> },
              ...(can.update
                ? [
                    {
                      key: "actions",
                      header: "Aksi",
                      render: (t: Tariff) => (
                        <div className="flex gap-1.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} aria-label="Edit tarif">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(t)} aria-label="Hapus tarif">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["tariff"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Tarif" : "Tambah Tarif"}</DialogTitle>
            <DialogDescription>Satu kombinasi koridor + tipe customer hanya boleh punya satu tarif aktif.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kota Asal" htmlFor="tf-origin">
                <Input id="tf-origin" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} placeholder="Jakarta Pusat" required disabled={busy} />
              </Field>
              <Field label="Kota Tujuan" htmlFor="tf-destination">
                <Input id="tf-destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Bandung" required disabled={busy} />
              </Field>
              <Field label="Tipe Customer" htmlFor="tf-type">
                <FormSelect
                  value={form.customerType}
                  onValueChange={(value) => setForm({ ...form, customerType: value, pricingMethod: value === "b2b" ? form.pricingMethod : "PER_KG" })}
                  placeholder="Semua tipe"
                  options={[{ value: "b2b", label: "B2B" }, { value: "b2c", label: "B2C" }]}
                  disabled={busy}
                />
              </Field>
              {form.customerType === "b2b" ? (
                <>
                  <Field label="Metode Harga (B2B)" htmlFor="tf-method" hint="B2C selalu pakai /kg - B2B bisa pilih /kg, /koli, atau /cubic.">
                    <FormSelect
                      value={form.pricingMethod}
                      onValueChange={(value) => setForm({ ...form, pricingMethod: value as TariffForm["pricingMethod"] })}
                      options={[
                        { value: "PER_KG", label: "Per kg" },
                        { value: "PER_KOLI", label: "Per koli" },
                        { value: "PER_CUBIC", label: "Per cubic (m³)" },
                      ]}
                      disabled={busy}
                    />
                  </Field>
                  {form.pricingMethod === "PER_KG" && (
                    <Field label="Tarif per kg (Rp)" htmlFor="tf-rate">
                      <NumberInput id="tf-rate" value={form.ratePerKg} onChange={(e) => setForm({ ...form, ratePerKg: e.target.value })} placeholder="4500" required disabled={busy} />
                    </Field>
                  )}
                  {form.pricingMethod === "PER_KOLI" && (
                    <Field label="Tarif per koli (Rp)" htmlFor="tf-rate-koli">
                      <NumberInput id="tf-rate-koli" value={form.ratePerKoli} onChange={(e) => setForm({ ...form, ratePerKoli: e.target.value })} placeholder="25000" required disabled={busy} />
                    </Field>
                  )}
                  {form.pricingMethod === "PER_CUBIC" && (
                    <Field label="Tarif per m³ (Rp)" htmlFor="tf-rate-cubic">
                      <NumberInput id="tf-rate-cubic" value={form.ratePerCubic} onChange={(e) => setForm({ ...form, ratePerCubic: e.target.value })} placeholder="850000" required disabled={busy} />
                    </Field>
                  )}
                </>
              ) : (
                <Field label="Tarif per kg (Rp)" htmlFor="tf-rate">
                  <NumberInput id="tf-rate" value={form.ratePerKg} onChange={(e) => setForm({ ...form, ratePerKg: e.target.value })} placeholder="4500" required disabled={busy} />
                </Field>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Min. kg" htmlFor="tf-min">
                  <NumberInput id="tf-min" value={form.minChargeableKg} onChange={(e) => setForm({ ...form, minChargeableKg: e.target.value })} disabled={busy} />
                </Field>
                <Field label="Multiplier (kg/m³)" htmlFor="tf-multiplier" hint="volumetrik = L×W×H/1.000.000 × ini">
                  <NumberInput id="tf-multiplier" value={form.volumetricMultiplier} onChange={(e) => setForm({ ...form, volumetricMultiplier: e.target.value })} placeholder="250" disabled={busy} />
                </Field>
              </div>
              {form.customerType === "b2b" && form.pricingMethod === "PER_KOLI" && (
                <Field label="Min. koli" htmlFor="tf-min-koli" hint="Shipment selalu ditagih minimal sekian koli">
                  <NumberInput id="tf-min-koli" value={form.minChargeableKoli} onChange={(e) => setForm({ ...form, minChargeableKoli: e.target.value })} disabled={busy} />
                </Field>
              )}
              {form.customerType === "b2b" && form.pricingMethod === "PER_CUBIC" && (
                <Field label="Min. m³" htmlFor="tf-min-cubic" hint="0 = tanpa batas minimum">
                  <NumberInput id="tf-min-cubic" value={form.minChargeableM3} onChange={(e) => setForm({ ...form, minChargeableM3: e.target.value })} disabled={busy} />
                </Field>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Pembulatan" htmlFor="tf-rounding">
                  <FormSelect
                    value={form.roundingMode}
                    onValueChange={(value) => setForm({ ...form, roundingMode: value })}
                    options={[{ value: "UP", label: "Round up" }, { value: "NEAREST", label: "Nearest" }]}
                    disabled={busy}
                  />
                </Field>
                <Field label="Satuan (kg)" htmlFor="tf-unit">
                  <NumberInput id="tf-unit" value={form.roundingUnitKg} onChange={(e) => setForm({ ...form, roundingUnitKg: e.target.value })} disabled={busy} />
                </Field>
              </div>
              <Field label="Berlaku dari" htmlFor="tf-from">
                <Input id="tf-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} required disabled={busy} />
              </Field>
              <Field label="Berlaku sampai" htmlFor="tf-to" hint="Kosongkan = tanpa batas">
                <Input id="tf-to" type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} disabled={busy} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Tarif"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus tarif {confirmDelete ? `${confirmDelete.origin} → ${confirmDelete.destination}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>Tarif yang sudah dipakai menghitung harga akan dinonaktifkan, bukan dihapus.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
