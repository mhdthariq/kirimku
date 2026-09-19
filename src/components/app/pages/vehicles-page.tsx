"use client";

import { useMemo, useState } from "react";
import { CarFront, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Options, type Vehicle } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge, StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, NumberInput, SubmitButton, Textarea, formatNumber } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface VehicleForm {
  vehicleNumber: string;
  name: string;
  status: string;
  maxWeightKg: string;
  maxVolumeM3: string;
  // Revise round 9 — physical cargo box dimensions in meters.
  // When all three are set, maxVolumeM3 is auto-computed as L × W × H.
  lengthM: string;
  widthM: string;
  heightM: string;
  notes: string;
  ownerId: string;
}

const EMPTY: VehicleForm = { vehicleNumber: "", name: "", status: "ACTIVE", maxWeightKg: "", maxVolumeM3: "", lengthM: "", widthM: "", heightM: "", notes: "", ownerId: "" };

export function VehiclesPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "vehicle.view"),
    create: hasPermission(user, "vehicle.create"),
    update: hasPermission(user, "vehicle.update"),
  };

  const { data, loading, reload } = useApiData<Vehicle[]>(() => apiGet<Vehicle[]>("/vehicles"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter((v) => !q || v.vehicleNumber.toLowerCase().includes(q) || (v.name ?? "").toLowerCase().includes(q));
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(v: Vehicle) {
    setEditing(v);
    setForm({
      vehicleNumber: v.vehicleNumber,
      name: v.name ?? "",
      status: v.status,
      maxWeightKg: String(v.maxWeightKg),
      maxVolumeM3: String(v.maxVolumeM3),
      lengthM: v.lengthM != null ? String(v.lengthM) : "",
      widthM: v.widthM != null ? String(v.widthM) : "",
      heightM: v.heightM != null ? String(v.heightM) : "",
      notes: v.notes ?? "",
      ownerId: v.ownerId ? String(v.ownerId) : "",
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Revise round 9 — auto-compute maxVolumeM3 from L × W × H when all
    // three dimensions are entered. The form's maxVolumeM3 field becomes
    // read-only in that case (see the field below).
    const L = Number(form.lengthM || 0);
    const W = Number(form.widthM || 0);
    const H = Number(form.heightM || 0);
    const dimsComplete = form.lengthM !== "" && form.widthM !== "" && form.heightM !== "" && L > 0 && W > 0 && H > 0;
    const computedVolume = dimsComplete ? Math.round(L * W * H * 1000) / 1000 : Number(form.maxVolumeM3);
    const payload = {
      vehicleNumber: form.vehicleNumber,
      name: form.name || null,
      status: form.status,
      maxWeightKg: Number(form.maxWeightKg),
      maxVolumeM3: computedVolume,
      lengthM: form.lengthM === "" ? null : Number(form.lengthM),
      widthM: form.widthM === "" ? null : Number(form.widthM),
      heightM: form.heightM === "" ? null : Number(form.heightM),
      notes: form.notes || null,
      // Revise.md §13 — optional Vehicle Owner (empty = company-owned)
      ownerId: form.ownerId ? Number(form.ownerId) : null,
    };
    const ok = await runAction(
      () => (editing ? apiPut(`/vehicles/${editing.id}`, payload) : apiPost("/vehicles", payload)),
      { success: editing ? "Kendaraan diperbarui." : "Kendaraan dibuat." },
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
    const ok = await runAction(() => apiDelete(`/vehicles/${target.id}`), { success: "Kendaraan diproses." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Kendaraan" subtitle="Anda tidak memiliki izin melihat kendaraan." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kendaraan"
        subtitle="Armada pengangkut beserta kapasitas dan kru default."
        icon={<CarFront className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Tambah Kendaraan
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
            searchPlaceholder="Cari nopol / nama…"
            emptyMessage="Belum ada kendaraan. Klik “Tambah Kendaraan” untuk membuat."
            columns={[
              {
                key: "vehicleNumber",
                header: "Nomor Polisi",
                primary: true,
                render: (v) => (
                  <div>
                    <p className="font-mono font-semibold text-foreground">{v.vehicleNumber}</p>
                    {v.name && <p className="text-xs text-muted-foreground">{v.name}</p>}
                  </div>
                ),
              },
              {
                // Revise round 9 — Ukuran column shown BEFORE Kapasitas.
                // Displays P × L × T in meters when dimensions are set.
                key: "dimensions",
                header: "Ukuran",
                hideOnMobile: true,
                render: (v) =>
                  v.lengthM != null && v.widthM != null && v.heightM != null ? (
                    <div className="text-xs text-muted-foreground">
                      <p>P {formatNumber(v.lengthM, 3)}m</p>
                      <p>L {formatNumber(v.widthM, 3)}m</p>
                      <p>T {formatNumber(v.heightM, 3)}m</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: "capacity",
                header: "Kapasitas",
                render: (v) => (
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(v.maxWeightKg, 0)} kg · {formatNumber(v.maxVolumeM3, 0)} m³
                  </span>
                ),
              },
              {
                key: "owner",
                header: "Vehicle Owner",
                render: (v) =>
                  v.owner ? (
                    <div>
                      <p className="text-sm font-medium">{v.owner.user.name}</p>
                      <p className="text-[11px] text-muted-foreground">partner</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">perusahaan</span>
                  ),
              },
              {
                key: "crew",
                header: "Kru Default",
                hideOnMobile: true,
                render: (v) => {
                  const assignment = v.assignments?.[0];
                  if (!assignment) return "—";
                  return (
                    <span className="text-sm text-muted-foreground">
                      {assignment.driver?.name ?? "—"} (driver){assignment.kenek ? `, ${assignment.kenek.name} (kenek)` : ""}
                    </span>
                  );
                },
              },
              { key: "transports", header: "Transport", hideOnMobile: true, render: (v) => v._count?.transports ?? 0 },
              { key: "status", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
              ...(can.update
                ? [
                    {
                      key: "actions",
                      header: "Aksi",
                      render: (v: Vehicle) => (
                        <div className="flex gap-1.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(v)} aria-label={`Edit ${v.vehicleNumber}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setConfirmDelete(v)}
                            aria-label={`Hapus ${v.vehicleNumber}`}
                          >
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
          <ActivityLogPanel entityTypes={["vehicle"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Kendaraan — ${editing.vehicleNumber}` : "Tambah Kendaraan"}</DialogTitle>
            <DialogDescription>Armada baru bisa langsung dipakai membuat transport.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nomor Polisi" htmlFor="v-number">
                <Input id="v-number" value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} placeholder="B 9102 KTA" required disabled={busy} />
              </Field>
              <Field label="Nama / Tipe" htmlFor="v-name">
                <Input id="v-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CDD 6 Ban" disabled={busy} />
              </Field>
              <Field label="Status" htmlFor="v-status">
                <FormSelect
                  value={form.status}
                  onValueChange={(value) => setForm({ ...form, status: value })}
                  options={[{ value: "ACTIVE", label: "Aktif" }, { value: "MAINTENANCE", label: "Maintenance" }, { value: "INACTIVE", label: "Nonaktif" }]}
                  disabled={busy}
                />
              </Field>
              <Field label="Max Berat (kg)" htmlFor="v-weight">
                <NumberInput id="v-weight" value={form.maxWeightKg} onChange={(e) => setForm({ ...form, maxWeightKg: e.target.value })} placeholder="3500" required disabled={busy} />
              </Field>
              {/* Revise round 9 — physical cargo box dimensions in meters.
                  When all three are set, maxVolumeM3 is auto-computed as L × W × H
                  and the volume field below becomes read-only. */}
              <Field
                label="Ukuran — Panjang (m)"
                htmlFor="v-length"
                className="sm:col-span-2"
                hint="Isi Panjang × Lebar × Tinggi (m) untuk menghitung volume otomatis."
              >
                <div className="grid grid-cols-3 gap-2">
                  <NumberInput
                    id="v-length"
                    value={form.lengthM}
                    onChange={(e) => setForm({ ...form, lengthM: e.target.value })}
                    placeholder="4.906"
                    step="0.001"
                    min="0"
                    disabled={busy}
                  />
                  <NumberInput
                    id="v-width"
                    value={form.widthM}
                    onChange={(e) => setForm({ ...form, widthM: e.target.value })}
                    placeholder="1.993"
                    step="0.001"
                    min="0"
                    disabled={busy}
                  />
                  <NumberInput
                    id="v-height"
                    value={form.heightM}
                    onChange={(e) => setForm({ ...form, heightM: e.target.value })}
                    placeholder="2.050"
                    step="0.001"
                    min="0"
                    disabled={busy}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>P</span>
                  <span>·</span>
                  <span>L</span>
                  <span>·</span>
                  <span>T</span>
                  <span className="ml-auto">
                    {form.lengthM !== "" && form.widthM !== "" && form.heightM !== "" && Number(form.lengthM) > 0 && Number(form.widthM) > 0 && Number(form.heightM) > 0
                      ? `= ${Math.round(Number(form.lengthM) * Number(form.widthM) * Number(form.heightM) * 1000) / 1000} m³`
                      : "isi ketiganya untuk auto-volume"}
                  </span>
                </div>
              </Field>
              <Field
                label="Max Volume (m³)"
                htmlFor="v-volume"
                hint={
                  form.lengthM !== "" && form.widthM !== "" && form.heightM !== "" && Number(form.lengthM) > 0 && Number(form.widthM) > 0 && Number(form.heightM) > 0
                    ? "Auto-computed dari ukuran — clear ukuran untuk override manual."
                    : "Boleh diisi manual jika ukuran tidak diisi."
                }
              >
                <NumberInput
                  id="v-volume"
                  value={
                    form.lengthM !== "" && form.widthM !== "" && form.heightM !== "" && Number(form.lengthM) > 0 && Number(form.widthM) > 0 && Number(form.heightM) > 0
                      ? String(Math.round(Number(form.lengthM) * Number(form.widthM) * Number(form.heightM) * 1000) / 1000)
                      : form.maxVolumeM3
                  }
                  onChange={(e) => setForm({ ...form, maxVolumeM3: e.target.value })}
                  placeholder="14"
                  required
                  disabled={
                    busy ||
                    (form.lengthM !== "" && form.widthM !== "" && form.heightM !== "" && Number(form.lengthM) > 0 && Number(form.widthM) > 0 && Number(form.heightM) > 0)
                  }
                />
              </Field>
              <Field label="Catatan" htmlFor="v-notes" className="sm:col-span-2">
                <Textarea id="v-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional" disabled={busy} />
              </Field>
              {/* Revise.md §13 — link the vehicle to its Vehicle Owner */}
              <Field
                label="Vehicle Owner"
                htmlFor="v-owner"
                className="sm:col-span-2"
                hint="Kendaraan partner dihubungkan ke pemiliknya — profit share transport dibayarkan ke wallet owner."
              >
                <FormSelect
                  value={form.ownerId}
                  onValueChange={(v) => setForm({ ...form, ownerId: v === "none" ? "" : v })}
                  placeholder="Milik perusahaan"
                  options={[
                    { value: "none", label: "Milik perusahaan (tanpa owner)" },
                    ...(options?.vehicleOwners ?? []).map((o) => ({ value: String(o.id), label: `${o.name} (share ${o.profitShare.partner}%)` })),
                  ]}
                  disabled={busy}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Kendaraan"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kendaraan {confirmDelete?.vehicleNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Kendaraan yang sudah dipakai transport akan dinonaktifkan, bukan dihapus, agar history tetap utuh.
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
