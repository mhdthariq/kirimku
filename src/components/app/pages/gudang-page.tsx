"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Warehouse } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge } from "@/components/app/status-badge";
import { Field, Input, SubmitButton, Textarea, formatNumber } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

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
  };

  const { data, loading, reload } = useApiData<Warehouse[]>(() => apiGet<Warehouse[]>("/warehouses?include_inactive=true"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<GudangForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null);

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

  if (!can.view) {
    return <PageHeader title="Gudang" subtitle="Anda tidak memiliki izin melihat data gudang." />;
  }

  const lat = form.latitude === "" ? null : Number(form.latitude);
  const lng = form.longitude === "" ? null : Number(form.longitude);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gudang"
        subtitle="Titik fisik jaringan pengiriman — asal, transit, dan tujuan kiriman."
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
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["warehouse"]} />
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
    </div>
  );
}
