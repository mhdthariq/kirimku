"use client";

import { useMemo, useState } from "react";
import { Building2, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Options, type Tariff } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { SubmitButton, formatDate, formatNumber } from "@/components/app/form-parts";
import { TariffFormFields } from "@/components/app/tariff-form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTariffPayload, emptyTariffForm, tariffLabel, tariffTabOf, tariffToForm, validateTariffForm, type TariffFormState, type TariffTab } from "@/presentation/tariff-form";
import { customerPrimaryName } from "@/presentation/customer-display";
import { toast } from "sonner";

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
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TariffTab | "activity">("b2c");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<TariffTab>("b2c");
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [form, setForm] = useState<TariffFormState>(emptyTariffForm());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Tariff | null>(null);

  const rowsByTab = useMemo(() => {
    const q = search.toLowerCase();
    const all = (data ?? []).filter((t) =>
      !q ||
      t.origin.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q) ||
      (t.name ?? "").toLowerCase().includes(q) ||
      (t.customer ? customerPrimaryName({ ...t.customer, type: "b2b" }) : "").toLowerCase().includes(q),
    );
    return { b2c: all.filter((t) => tariffTabOf(t) === "b2c"), b2b: all.filter((t) => tariffTabOf(t) === "b2b") };

  }, [data, search]);

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

  const nameCol = {
    key: "lane",
    header: "Tarif",
    primary: true,
    render: (t: Tariff) => (
      <div>
        <p className="font-semibold text-foreground">{t.name || <span className="font-normal text-muted-foreground">(tanpa nama)</span>}</p>
        <p className="text-xs text-muted-foreground">
          {t.origin} → {t.destination}
        </p>
      </div>
    ),
  };
  // B2B only: which customer this tariff is tied to — same badge style as the
  // "Marketing (PIC)" column on the Customers page.
  const customerCol = {
    key: "customer",
    header: "Customer",
    render: (t: Tariff) =>
      t.customer ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          <Building2 className="h-3.5 w-3.5" /> {customerPrimaryName({ ...t.customer, type: "b2b" })}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Edit tarif ini dan pilih customer, kalau tidak tarif ini tidak muncul di pembuatan shipment.">
          Belum terikat customer
        </span>
      ),
  };
  const rateCol = {
    key: "rate",
    header: "Tarif",
    render: (t: Tariff) => {
      const method = t.customerType === "b2b" ? (t.pricingMethod ?? "PER_KG") : "PER_KG";
      const rate = method === "PER_KOLI" ? t.ratePerKoli ?? 0 : method === "PER_CUBIC" ? t.ratePerCubic ?? 0 : t.ratePerKg;
      return (
        <span className="font-semibold">
          Rp{rate.toLocaleString("id-ID")} <span className="font-normal text-muted-foreground">{PRICING_METHOD_LABEL[method]}</span>
        </span>
      );
    },
  };
  const rulesCol = {
    key: "rules",
    header: "Aturan",
    hideOnMobile: true,
    render: (t: Tariff) => {
      const method = t.customerType === "b2b" ? (t.pricingMethod ?? "PER_KG") : "PER_KG";
      if (method === "PER_KOLI") return <span className="text-xs text-muted-foreground">min {formatNumber(t.minChargeableKoli ?? 1, 0)} koli / shipment</span>;
      if (method === "PER_CUBIC") return <span className="text-xs text-muted-foreground">min {formatNumber(t.minChargeableM3 ?? 0, 3)} m³ / shipment</span>;
      if (t.customerType === "b2b") return <span className="text-xs text-muted-foreground">min {formatNumber(t.minChargeableKg)} kg · berat yang diinput × tarif/kg</span>;
      return (
        <span className="text-xs text-muted-foreground">
          min {formatNumber(t.minChargeableKg)} kg · multiplier {formatNumber(t.volumetricMultiplier, 0)} kg/m³ · {t.roundingMode === "UP" ? "round up" : "nearest"} {formatNumber(t.roundingUnitKg)} kg
        </span>
      );
    },
  };
  const commonCols = [
    { key: "effective", header: "Berlaku", hideOnMobile: true, render: (t: Tariff) => `${formatDate(t.effectiveFrom)}${t.effectiveTo ? ` – ${formatDate(t.effectiveTo)}` : " – ∞"}` },
    { key: "status", header: "Status", render: (t: Tariff) => <ActiveBadge active={t.isActive} /> },
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
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tarif"
        subtitle="B2C selalu /kg. B2B terikat ke satu customer dan bisa /kg, /koli, atau /cubic (m³)."
        icon={<Tag className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Tarif {activeTab === "b2b" ? "B2B" : "B2C"}
            </Button>
          )
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TariffTab | "activity")}>
        <TabsList>
          <TabsTrigger value="b2c">B2C ({rowsByTab.b2c.length})</TabsTrigger>
          <TabsTrigger value="b2b">B2B ({rowsByTab.b2b.length})</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="b2c" className="mt-3">
          <DataTable
            rows={rowsByTab.b2c}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nama / koridor…"
            emptyMessage="Belum ada tarif B2C. Klik “Tambah Tarif B2C” untuk membuat."
            columns={[nameCol, rateCol, rulesCol, ...commonCols]}
          />
        </TabsContent>
        <TabsContent value="b2b" className="mt-3">
          <DataTable
            rows={rowsByTab.b2b}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nama / koridor / customer…"
            emptyMessage="Belum ada tarif B2B. Klik “Tambah Tarif B2B” atau isi saat membuat customer B2B."
            columns={[nameCol, customerCol, rateCol, rulesCol, ...commonCols]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["tariff"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Tarif" : "Tambah Tarif"} {dialogTab.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {dialogTab === "b2b"
                ? "Tarif B2B terikat ke satu customer - hanya customer itu yang melihatnya saat membuat shipment."
                : "Tarif B2C selalu per kg. Koridor yang sama boleh punya beberapa tarif selama namanya berbeda."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <TariffFormFields tab={dialogTab} form={form} setForm={setForm} busy={busy} customerOptions={b2bCustomerOptions} />
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
