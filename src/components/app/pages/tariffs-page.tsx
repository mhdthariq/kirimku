"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarDays, MapPin, Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Options, type Tariff } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { SubmitButton, formatDate, formatNumber } from "@/components/app/form-parts";
import { TariffFormFields } from "@/components/app/tariff-form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTariffPayload, emptyTariffForm, tariffLabel, tariffTabOf, tariffToForm, validateTariffForm, type TariffFormState, type TariffTab } from "@/presentation/tariff-form";
import { customerPrimaryName } from "@/presentation/customer-display";
import { toast } from "sonner";

const PRICING_METHOD_LABEL: Record<string, string> = {
  PER_KG: "/ kg (aktual / volumetrik)",
  PER_KG_SIMPLE: "/ kg (aktual)",
  PER_KOLI: "/ koli",
  PER_CUBIC: "/ m³ (cubic)",
};

function TariffStatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="group" aria-label="Filter status tarif" className="flex w-full gap-1 rounded-xl border bg-muted/40 p-1 sm:w-auto">
      {[{ value: "active", label: "Aktif" }, { value: "all", label: "All" }, { value: "inactive", label: "Nonaktif" }].map((option) => (
        <Button key={option.value} size="sm" variant={value === option.value ? "default" : "ghost"}
          aria-pressed={value === option.value} className="min-h-10 flex-1 rounded-lg px-4 sm:flex-none"
          onClick={() => onChange(option.value)}>{option.label}</Button>
      ))}
    </div>
  );
}

export function TariffsPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "tariff.view"),
    create: hasPermission(user, "tariff.create"),
    update: hasPermission(user, "tariff.update"),
  };

  const { data, loading, reload } = useApiData<Tariff[]>(() => apiGet<Tariff[]>("/tariffs"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [activeTab, setActiveTab] = useState<TariffTab | "activity">("b2c");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<TariffTab>("b2c");
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [form, setForm] = useState<TariffFormState>(emptyTariffForm());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Tariff | null>(null);

  const rowsByTab = useMemo(() => {
    const q = search.toLowerCase();
    const all = (data ?? []).filter((t) => statusFilter === "all" || t.isActive === (statusFilter === "active")).filter((t) =>
      !q ||
      t.origin.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q) ||
      (t.name ?? "").toLowerCase().includes(q) ||
      (t.customer ? customerPrimaryName({ ...t.customer, type: "b2b" }) : "").toLowerCase().includes(q),
    );
    return { b2c: all.filter((t) => tariffTabOf(t) === "b2c"), b2b: all.filter((t) => tariffTabOf(t) === "b2b") };

  }, [data, search, statusFilter]);

  const b2bCustomerOptions = useMemo(
    () =>
      (options?.customers ?? [])
        .filter((c) => c.type === "b2b")
        .map((c) => ({ value: String(c.id), label: c.companyName ? `${c.companyName} (PIC: ${c.name})` : c.name })),
    [options],
  );

  function openCreate() {
    const tab: TariffTab = activeTab === "b2b" ? "b2b" : "b2c";
    setEditing(null);
    setDialogTab(tab);
    setForm(emptyTariffForm());
    setDialogOpen(true);
  }

  function openEdit(t: Tariff) {
    setEditing(t);
    setDialogTab(tariffTabOf(t));
    setForm(tariffToForm(t));
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateTariffForm(dialogTab, form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const payload = buildTariffPayload(dialogTab, form);
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

  const activeTariffs = (data ?? []).filter((tariff) => tariff.isActive);
  const corridorCount = new Set(activeTariffs.map((tariff) => JSON.stringify([tariff.origin, tariff.destination]))).size;

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Tarif"
        subtitle="Kelola harga pengiriman dan masa berlaku untuk setiap rute."
        icon={<Tag className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate} className="min-h-11 rounded-xl px-5 shadow-sm">
              <Plus className="h-4 w-4" /> Tambah Tarif {activeTab === "b2b" ? "B2B" : "B2C"}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3" aria-label="Ringkasan tarif">
        {[
          { label: "Total Tarif", value: data?.length ?? 0, detail: "Seluruh versi tarif", icon: Tag },
          { label: "Tarif Aktif", value: activeTariffs.length, detail: "Tarif dengan status aktif", icon: CalendarDays },
          { label: "Koridor Aktif", value: corridorCount, detail: "Rute asal dan tujuan", icon: MapPin },
        ].map((item) => (
          <div key={item.label} className="flex min-w-0 items-start justify-between gap-2 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{loading ? "…" : item.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <div className="hidden rounded-xl bg-primary/10 p-2.5 text-primary sm:block"><item.icon className="h-4 w-4" /></div>
          </div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TariffTab | "activity")} className="min-w-0 gap-4">
        <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 rounded-xl p-1.5 sm:justify-start">
          <TabsTrigger value="b2c" className="min-h-10 rounded-lg px-4">B2C ({rowsByTab.b2c.length})</TabsTrigger>
          <TabsTrigger value="b2b" className="min-h-10 rounded-lg px-4">B2B ({rowsByTab.b2b.length})</TabsTrigger>
          <TabsTrigger value="activity" className="min-h-10 rounded-lg px-4">Log Aktivitas</TabsTrigger>
        </TabsList>
        {(["b2c", "b2b"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="min-w-0 space-y-4">
            <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-label={`Pengaturan daftar tarif ${tab.toUpperCase()}`}>
              <div>
                <h2 className="text-base font-semibold">Tarif {tab.toUpperCase()}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tab === "b2b" ? "Harga khusus yang terhubung ke masing-masing customer bisnis." : "Harga pengiriman umum berdasarkan berat, koli, atau volume."}</p>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative min-w-0 flex-1 lg:max-w-md">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Cari tarif" value={search} onChange={(event) => setSearch(event.target.value)}
                    placeholder={tab === "b2b" ? "Cari nama / koridor / customer…" : "Cari nama / koridor…"}
                    className="h-11 rounded-xl bg-background pl-10" />
                </div>
                <TariffStatusFilter value={statusFilter} onChange={setStatusFilter} />
              </div>
            </section>
            <p role="status" className="px-1 text-xs text-muted-foreground">{loading ? "Memuat tarif…" : `${rowsByTab[tab].length} tarif ditampilkan`}</p>
            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Memuat tarif">
                {[0, 1, 2].map((id) => <Skeleton key={id} className="h-80 rounded-2xl" />)}
              </div>
            ) : rowsByTab[tab].length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-5 py-14 text-center">
                <div className="mb-4 rounded-2xl bg-muted p-4"><Tag className="h-6 w-6 text-muted-foreground" /></div>
                <h3 className="font-semibold">Tidak ada tarif {tab.toUpperCase()} yang sesuai dengan pencarian dan filter.</h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">Coba kata kunci atau filter lain untuk menemukan tarif.</p>
                {(search || statusFilter !== "active") && <Button variant="outline" className="mt-5 rounded-xl" onClick={() => { setSearch(""); setStatusFilter("active"); }}>Reset Filter</Button>}
              </div>
            ) : (
              <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rowsByTab[tab].map((tariff) => <TariffCard key={tariff.id} tariff={tariff} canUpdate={can.update} onEdit={openEdit} onDelete={setConfirmDelete} />)}
              </div>
            )}
          </TabsContent>
        ))}
        <TabsContent value="activity">
          <div className="rounded-2xl border bg-card p-4 sm:p-5"><ActivityLogPanel entityTypes={["tariff"]} /></div>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Tarif" : "Tambah Tarif"} {dialogTab.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {dialogTab === "b2b"
                ? "Tarif B2B terikat ke satu customer - hanya customer itu yang melihatnya saat membuat shipment."
                : "Tarif B2C bisa memakai kg volumetrik, kg aktual, koli, atau volume. Koridor yang sama boleh punya beberapa tarif selama namanya berbeda."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="rounded-xl border bg-muted/20 p-4">
              <TariffFormFields tab={dialogTab} form={form} setForm={setForm} busy={busy} customerOptions={b2bCustomerOptions} />
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
            <AlertDialogTitle>Hapus tarif {confirmDelete ? tariffLabel(confirmDelete) : ""}?</AlertDialogTitle>
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

function tariffRules(tariff: Tariff): string {
  const method = tariff.pricingMethod ?? "PER_KG";
  if (method === "PER_KOLI") return `Minimum ${formatNumber(tariff.minChargeableKoli ?? 1, 0)} koli per shipment`;
  if (method === "PER_CUBIC") return `Minimum ${formatNumber(tariff.minChargeableM3 ?? 0, 3)} m³ per shipment`;
  if (method === "PER_KG_SIMPLE" || tariff.customerType === "b2b") return `Minimum ${formatNumber(tariff.minChargeableKg)} kg · berat aktual`;
  return `Minimum ${formatNumber(tariff.minChargeableKg)} kg · ${formatNumber(tariff.volumetricMultiplier, 0)} kg/m³ · ${tariff.roundingMode === "UP" ? "round up" : "nearest"} ${formatNumber(tariff.roundingUnitKg)} kg`;
}

function TariffCard({ tariff, canUpdate, onEdit, onDelete }: {
  tariff: Tariff;
  canUpdate: boolean;
  onEdit: (tariff: Tariff) => void;
  onDelete: (tariff: Tariff) => void;
}) {
  const method = tariff.pricingMethod ?? "PER_KG";
  const rate = method === "PER_KOLI" ? tariff.ratePerKoli ?? 0 : method === "PER_CUBIC" ? tariff.ratePerCubic ?? 0 : tariff.ratePerKg;
  const unit = method === "PER_KOLI" ? "Per koli" : method === "PER_CUBIC" ? "Per m³" : "Per kg";
  return (
    <article aria-label={tariffLabel(tariff)} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex-1 space-y-5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug [overflow-wrap:anywhere]">{tariff.name || "Tanpa nama"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Tarif {tariffTabOf(tariff).toUpperCase()}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{unit}</span>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="break-words font-medium">{tariff.origin}</p>
            <p className="mt-1 flex items-start gap-2 text-muted-foreground"><ArrowRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{tariff.destination}</span></p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Harga pengiriman</p>
          <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums [overflow-wrap:anywhere]">Rp{rate.toLocaleString("id-ID")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{PRICING_METHOD_LABEL[method]}</p>
        </div>
        {tariffTabOf(tariff) === "b2b" && (
          <div className="flex items-start gap-2 text-sm">
            <Building2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words font-medium">{tariff.customer ? customerPrimaryName({ ...tariff.customer, type: "b2b" }) : "Belum terikat customer"}</span>
          </div>
        )}
        <div className="space-y-2 border-t pt-4 text-xs">
          <p className="flex items-start gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{formatDate(tariff.effectiveFrom)} – {tariff.effectiveTo ? formatDate(tariff.effectiveTo) : "Tanpa batas"}</span></p>
          <p className="leading-relaxed text-muted-foreground">{tariffRules(tariff)}</p>
        </div>
      </div>
      {canUpdate && (
        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-4 py-3 sm:px-5">
          <Button variant="outline" className="min-h-10 rounded-lg" onClick={() => onEdit(tariff)} aria-label={`Edit tarif ${tariff.name || tariffLabel(tariff)}`}><Pencil className="h-3.5 w-3.5" /> Edit Tarif</Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-lg text-destructive hover:text-destructive" onClick={() => onDelete(tariff)} aria-label={`Hapus tarif ${tariff.name || tariffLabel(tariff)}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      )}
    </article>
  );
}
