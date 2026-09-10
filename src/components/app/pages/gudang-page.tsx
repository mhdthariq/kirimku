"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Bell, ChevronDown, MapPin, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type GudangWorkspace, type Warehouse } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { NotifyMarketingDialog } from "@/components/app/notify-marketing-dialog";
import { Field, Input, SubmitButton, Textarea, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LeafletPicker = dynamic(() => import("@/components/app/leaflet-picker").then((m) => m.LeafletPicker), {
  ssr: false,
  loading: () => <Skeleton className="h-[280px] w-full rounded-lg" />,
});

interface GudangForm {
  name: string;
  city: string;
  address: string;
  notes: string;
  customerSupportContact: string;
  latitude: string;
  longitude: string;
}

const EMPTY: GudangForm = { name: "", city: "", address: "", notes: "", customerSupportContact: "", latitude: "", longitude: "" };

export function GudangPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "warehouse.view"),
    create: hasPermission(user, "warehouse.create"),
    update: hasPermission(user, "warehouse.update"),
    delete: hasPermission(user, "warehouse.delete"),
    // Isi Gudang tab is powered by the /gudang workspace API (shipment.view)
    contents: hasPermission(user, "shipment.view"),
    notifyMarketing: hasPermission(user, "shipment.notify_marketing"),
  };

  const { data, loading, reload } = useApiData<Warehouse[]>(() => apiGet<Warehouse[]>("/warehouses?include_inactive=true"), []);
  const { data: workspace, loading: contentsLoading, reload: reloadContents } = useApiData<GudangWorkspace>(
    () => (can.contents ? apiGet<GudangWorkspace>("/gudang") : Promise.resolve(null as unknown as GudangWorkspace)),
    [can.contents],
  );
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<GudangForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null);
  const [expandedWarehouse, setExpandedWarehouse] = useState<number | null>(null);
  const [notifyTask, setNotifyTask] = useState<{ id: number; masterCode: string; remaining: number } | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (w) => !q || w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q) || (w.city ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(w: Warehouse) {
    setEditing(w);
    setForm({
      name: w.name,
      city: w.city ?? "",
      address: w.address ?? "",
      notes: w.notes ?? "",
      customerSupportContact: w.customerSupportContact ?? "",
      latitude: w.latitude == null ? "" : String(w.latitude),
      longitude: w.longitude == null ? "" : String(w.longitude),
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      name: form.name,
      city: form.city || null,
      address: form.address || null,
      notes: form.notes || null,
      customerSupportContact: form.customerSupportContact || null,
      latitude: form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude === "" ? null : Number(form.longitude),
    };
    const ok = await runAction(
      () => (editing ? apiPut(`/warehouses/${editing.id}`, payload) : apiPost("/warehouses", payload)),
      { success: editing ? "Gudang diperbarui." : "Gudang dibuat." },
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
    const ok = await runAction(() => apiDelete<{ deactivated?: boolean }>(`/warehouses/${target.id}`), {
      success: "Gudang diproses.",
    });
    if (ok) reload();
  }

  // Gudang master data is owner-only (menu hidden for everyone else; direct
  // hash access is stopped here too).
  if (!user?.isOwner) {
    return (
      <PageHeader
        title="Gudang"
        subtitle="Data master gudang hanya dapat dilihat oleh Owner. Staff gudang bekerja melalui menu Shipments."
      />
    );
  }

  if (!can.view) {
    return <PageHeader title="Gudang" subtitle="Anda tidak memiliki izin melihat data gudang." />;
  }

  const lat = form.latitude === "" ? null : Number(form.latitude);
  const lng = form.longitude === "" ? null : Number(form.longitude);
  const contents = workspace?.warehouses ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gudang"
        subtitle={
          workspace?.scope?.scoped
            ? `Master gudang & isinya — akses terbatas ke ${workspace.scope.warehouseName ?? "gudang Anda"}.`
            : "Titik fisik jaringan pengiriman — asal, transit, dan tujuan kiriman beserta isinya."
        }
        icon={<WarehouseIcon className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Gudang
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          {can.contents && <TabsTrigger value="contents">Isi Gudang</TabsTrigger>}
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nama / kode / kota…"
            emptyMessage="Belum ada gudang. Klik “Tambah Gudang” untuk membuat."
            columns={[
              { key: "code", header: "Kode", primary: true, render: (w) => <span className="font-mono text-xs">{w.code}</span> },
              {
                key: "name",
                header: "Nama",
                render: (w) => (
                  <div>
                    <p className="font-medium text-foreground">{w.name}</p>
                    {w.address && <p className="text-xs text-muted-foreground">{w.address}</p>}
                  </div>
                ),
              },
              { key: "city", header: "Kota", render: (w) => w.city ?? "—" },
              {
                key: "cs",
                header: "CS Contact",
                hideOnMobile: true,
                render: (w) => w.customerSupportContact ?? "—",
              },
              {
                key: "coords",
                header: "Koordinat",
                hideOnMobile: true,
                render: (w) =>
                  w.latitude != null && w.longitude != null ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              { key: "status", header: "Status", render: (w) => <ActiveBadge active={w.isActive} /> },
              ...(can.update || can.delete
                ? [
                    {
                      key: "actions",
                      header: "Aksi",
                      render: (w: Warehouse) => (
                        <div className="flex gap-1.5">
                          {can.update && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(w)} aria-label={`Edit ${w.name}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {can.delete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setConfirmDelete(w)}
                              aria-label={`Hapus ${w.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </TabsContent>

        {/* ---------------- Isi Gudang: packages currently held at each gudang ---------------- */}
        {can.contents && (
          <TabsContent value="contents" className="mt-3 space-y-4">
            <p className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
              Kiriman yang <b>sedang tersimpan</b> di tiap gudang — paket RECEIVED_AT_GUDANG (gudang asal) dan ARRIVED_AT_GUDANG (gudang
              tujuan). {workspace?.scope?.scoped ? "Akses Anda dibatasi ke gudang Anda sendiri." : "Admin Gudang melihat semua gudang."}
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {contentsLoading &&
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}
              {contents.map((w) => (
                <Card key={w.id} className="gap-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-col gap-1 text-base sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <WarehouseIcon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{w.name}</span>
                      </span>
                      <span className="self-start rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground sm:self-auto sm:shrink-0">{w.city ?? "—"}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <p className="text-lg font-bold text-foreground">{w.heldPackages}</p>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Paket</p>
                      </div>
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <p className="text-lg font-bold text-foreground">{w.heldShipments}</p>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Shipment</p>
                      </div>
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <p className="text-lg font-bold text-foreground">{formatNumber(w.heldWeightKg, 1)}</p>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">kg</p>
                      </div>
                    </div>
                    {w.customerSupportContact && (
                      <p className="text-[11px] text-muted-foreground">CS Gudang: {w.customerSupportContact}</p>
                    )}
                    {w.unpaidCount > 0 && (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        {w.unpaidCount} shipment masih ada sisa pembayaran
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setExpandedWarehouse(expandedWarehouse === w.id ? null : w.id)}
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", expandedWarehouse === w.id && "rotate-180")} />
                      {expandedWarehouse === w.id ? "Sembunyikan detail" : "Lihat detail kiriman"}
                    </Button>
                    {expandedWarehouse === w.id && (
                      <div className="space-y-1.5">
                        {w.shipments.length === 0 && <p className="text-center text-xs text-muted-foreground">Gudang kosong.</p>}
                        {w.shipments.map((s) => (
                          <div key={s.id} className="rounded-lg border bg-card px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <a href={`#/shipments/${s.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                                {s.masterCode}
                              </a>
                              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {s.stage === "origin" ? "gudang asal" : "gudang tujuan"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {s.customerName} · {s.packages} paket · {formatNumber(s.weightKg)} kg · {s.volumeM3.toFixed(3)} m³
                            </p>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                              {s.remainingAmount != null && s.remainingAmount > 0 ? (
                                <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">sisa {formatRupiah(s.remainingAmount)}</span>
                              ) : (
                                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">lunas</span>
                              )}
                              {can.notifyMarketing && s.remainingAmount != null && s.remainingAmount > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => setNotifyTask({ id: s.id, masterCode: s.masterCode, remaining: s.remainingAmount ?? 0 })}
                                >
                                  <Bell className="h-3 w-3" /> Notify Marketing
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            {!contentsLoading && contents.length === 0 && (
              <p className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                Tidak ada gudang aktif — buat gudang di tab Daftar.
              </p>
            )}
          </TabsContent>
        )}

        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["warehouse", "shipment", "pickup", "delivery", "transport"]} />
        </TabsContent>
      </Tabs>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Gudang — ${editing.code}` : "Tambah Gudang"}</DialogTitle>
            <DialogDescription>
              {editing ? "Perbarui informasi gudang." : "Gudang baru akan mendapat kode otomatis (WH-xxxxxx). Klik peta untuk mengisi koordinat."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nama Gudang" htmlFor="g-name" className="sm:col-span-2">
                <Input id="g-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Gudang Bandung" required disabled={busy} />
              </Field>
              <Field label="Kota" htmlFor="g-city">
                <Input id="g-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bandung" disabled={busy} />
              </Field>
              <Field label="Alamat" htmlFor="g-address">
                <Input id="g-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jl. …" disabled={busy} />
              </Field>
              <Field label="Customer Support" htmlFor="g-cs" hint="dicetak di resi">
                <Input id="g-cs" value={form.customerSupportContact} onChange={(e) => setForm({ ...form, customerSupportContact: e.target.value })} placeholder="0811-1000-001" disabled={busy} />
              </Field>
              <Field label="Latitude" htmlFor="g-lat">
                <Input id="g-lat" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="-6.9175" disabled={busy} />
              </Field>
              <Field label="Longitude" htmlFor="g-lng">
                <Input id="g-lng" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="107.6191" disabled={busy} />
              </Field>
              <Field label="Catatan" htmlFor="g-notes" className="sm:col-span-2">
                <Textarea id="g-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional" disabled={busy} />
              </Field>
            </div>

            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                Pilih lokasi di peta (opsional)
              </p>
              <LeafletPicker
                latitude={Number.isFinite(lat as number) ? (lat as number) : null}
                longitude={Number.isFinite(lng as number) ? (lng as number) : null}
                onChange={(newLat, newLng) =>
                  setForm((f) => ({ ...f, latitude: newLat.toFixed(7), longitude: newLng.toFixed(7) }))
                }
                height={260}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Gudang"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus gudang {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Gudang yang sudah dipakai shipment akan dinonaktifkan agar history tetap aman. Tindakan ini tercatat di log audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notify marketing dialog (unpaid shipment held at a gudang) */}
      <NotifyMarketingDialog
        key={notifyTask ? `notify-${notifyTask.id}` : "notify-none"}
        task={notifyTask}
        onClose={() => setNotifyTask(null)}
        onDone={reloadContents}
      />
    </div>
  );
}
