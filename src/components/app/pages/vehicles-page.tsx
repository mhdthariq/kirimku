"use client";

import { useMemo, useState } from "react";
import { CarFront, Download, Gauge, History, Pencil, Plus, Trash2, Truck, Wand2, AlertTriangle, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Options, type Vehicle, type FleetCapacityResponse } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { ActiveBadge, StatusBadge } from "@/components/app/status-badge";
import { CapacityRing, OverallCapacityBadge } from "@/components/app/capacity-status-card";
import { VehicleCapacityHistoryDialog } from "@/components/app/vehicle-capacity-history-dialog";
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
  // Capacity Round — max koli (package count). Empty = NOT CONFIGURED.
  maxKoli: string;
  notes: string;
  ownerId: string;
}

const EMPTY: VehicleForm = { vehicleNumber: "", name: "", status: "ACTIVE", maxWeightKg: "", maxVolumeM3: "", lengthM: "", widthM: "", heightM: "", maxKoli: "", notes: "", ownerId: "" };

export function VehiclesPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "vehicle.view"),
    create: hasPermission(user, "vehicle.create"),
    update: hasPermission(user, "vehicle.update"),
  };

  const { data, loading, reload } = useApiData<Vehicle[]>(() => apiGet<Vehicle[]>("/vehicles"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  // Fleet capacity data (for the combined "Kapasitas Armada" tab).
  const { data: fleetData, loading: fleetLoading, reload: reloadFleet } = useApiData<FleetCapacityResponse>(() => apiGet<FleetCapacityResponse>("/fleet-capacity"), []);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyVehicle, setHistoryVehicle] = useState<{ id: number; vehicleNumber: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
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
      maxKoli: v.maxKoli != null ? String(v.maxKoli) : "",
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
      // Capacity Round — null when empty (NOT CONFIGURED).
      maxKoli: form.maxKoli === "" ? null : Number(form.maxKoli),
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

  /** Export the vehicle list to CSV, including maxKoli (Capacity Round). */
  function exportCsv() {
    const header = ["nopol", "nama", "status", "max_berat_kg", "max_volume_m3", "max_koli", "panjang_m", "lebar_m", "tinggi_m", "owner"];
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = (data ?? []).map((v) => [
      v.vehicleNumber, v.name ?? "", v.status, v.maxWeightKg, v.maxVolumeM3, v.maxKoli ?? "",
      v.lengthM ?? "", v.widthM ?? "", v.heightM ?? "", v.owner?.user.name ?? "perusahaan",
    ].map(esc).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vehicles-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  /** Bulk-configure maxKoli for all vehicles missing it (owner-only). */
  async function onBulkConfigure() {
    setBulkOpen(false);
    setBulkBusy(true);
    const ok = await runAction(
      () => apiPost<{ count: number }>("/fleet-capacity/bulk-configure-koli", {}),
      { success: "Konfigurasi maxKoli otomatis diterapkan." },
    );
    setBulkBusy(false);
    if (ok) { reloadFleet(); reload(); }
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
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.length}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {can.create && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Tambah Kendaraan
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="capacity">Kapasitas Armada</TabsTrigger>
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
                    <span className="text-xs text-muted-foreground">-</span>
                  ),
              },
              {
                key: "capacity",
                header: "Kapasitas",
                render: (v) => (
                  <div className="space-y-0.5">
                    <span className="text-sm text-muted-foreground">
                      {/* Revise round 11 - volume now shows 2 decimal places (e.g., 12.89 m³). */}
                      {formatNumber(v.maxWeightKg, 0)} kg · {formatNumber(v.maxVolumeM3, 2)} m³
                    </span>
                    {/* Capacity Round — max koli (null = NOT CONFIGURED) */}
                    <p className="text-[10px] text-muted-foreground">
                      Koli: {v.maxKoli != null ? formatNumber(v.maxKoli, 0) : "—"}
                    </p>
                  </div>
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
                  if (!assignment) return "-";
                  return (
                    <span className="text-sm text-muted-foreground">
                      {assignment.driver?.name ?? "-"} (driver){assignment.kenek ? `, ${assignment.kenek.name} (kenek)` : ""}
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

        {/* Combined Fleet Capacity tab (merged from the former standalone page). */}
        <TabsContent value="capacity" className="mt-3 space-y-4">
          {fleetLoading && !fleetData ? (
            <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Memuat data kapasitas armada…</p>
          ) : !fleetData ? (
            <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Gagal memuat data kapasitas.</p>
          ) : (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <FleetTile icon={<Truck className="h-4 w-4" />} label="Total Armada" value={fleetData.summary.total} />
                <FleetTile icon={<Gauge className="h-4 w-4" />} label="Aktif" value={fleetData.summary.active} accent="text-primary" />
                <FleetTile icon={<ShieldCheck className="h-4 w-4" />} label="Aman" value={fleetData.summary.ok} accent="text-emerald-600 dark:text-emerald-400" />
                <FleetTile icon={<AlertTriangle className="h-4 w-4" />} label="Hampir" value={fleetData.summary.warning} accent="text-orange-600 dark:text-orange-400" />
                <FleetTile icon={<AlertTriangle className="h-4 w-4" />} label="Over" value={fleetData.summary.overCapacity} accent="text-rose-600 dark:text-rose-400" />
                <FleetTile icon={<Gauge className="h-4 w-4" />} label="Koli Belum Diset" value={fleetData.summary.unconfiguredVehicles} accent="text-muted-foreground" />
              </div>

              {/* Bulk configure button (owner-only, when unconfigured > 0) */}
              {user?.isOwner && fleetData.summary.unconfiguredVehicles > 0 && (
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)} disabled={bulkBusy}>
                    <Wand2 className="h-4 w-4" /> Konfigurasi Otomatis ({fleetData.summary.unconfiguredVehicles})
                  </Button>
                </div>
              )}

              {/* Per-vehicle capacity table */}
              <DataTable
                rows={fleetData.vehicles}
                loading={fleetLoading}
                emptyMessage="Belum ada kendaraan."
                columns={[
                  {
                    key: "vehicle",
                    header: "Kendaraan",
                    primary: true,
                    render: (v) => (
                      <div className="flex items-center gap-2.5">
                        {v.activeCapacity ? <CapacityRing capacity={v.activeCapacity} size={36} /> : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground">idle</div>
                        )}
                        <div>
                          <p className="font-mono text-xs font-semibold text-foreground">{v.vehicleNumber}</p>
                          <p className="text-[11px] text-muted-foreground">{v.name ?? "-"}</p>
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "config",
                    header: "Limit",
                    render: (v) => (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <p>Berat: {formatNumber(v.maxWeightKg, 0)} KG</p>
                        <p>Volume: {formatNumber(v.maxVolumeM3, 2)} M³</p>
                        <p>Koli: {v.maxKoli != null ? formatNumber(v.maxKoli, 0) : "—"}</p>
                      </div>
                    ),
                  },
                  {
                    key: "active",
                    header: "Transport Aktif",
                    hideOnMobile: true,
                    render: (v) => (
                      <div className="text-xs">
                        <p className="font-semibold text-foreground">{v.activeTransportCount} transport</p>
                        {v.activeLoad ? (
                          <p className="text-muted-foreground">{formatNumber(v.activeLoad.totalActualWeightKg, 1)} KG · {formatNumber(v.activeLoad.totalVolumeM3, 2)} M³ · {formatNumber(v.activeLoad.totalKoli, 0)} koli</p>
                        ) : <p className="text-muted-foreground">idle</p>}
                      </div>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status Kapasitas",
                    render: (v) => v.activeCapacity ? (
                      <div className="space-y-1">
                        <OverallCapacityBadge state={v.activeCapacity.overallStatus} />
                        <div className="flex gap-1">
                          {([["B", v.activeCapacity.weight.status], ["V", v.activeCapacity.volume.status], ["K", v.activeCapacity.koli.status]] as const).map(([lbl, st]) => (
                            <span key={lbl} className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${st === "OK" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : st === "WARNING" ? "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300" : st === "OVERLIMIT" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`}>{lbl}</span>
                          ))}
                        </div>
                      </div>
                    ) : <span className="text-[11px] text-muted-foreground">idle</span>,
                  },
                  {
                    key: "actions",
                    header: "Aksi",
                    render: (v) => (
                      <Button variant="outline" size="sm" className="h-7" onClick={() => setHistoryVehicle({ id: v.id, vehicleNumber: v.vehicleNumber })}>
                        <History className="h-3.5 w-3.5" /> Riwayat
                      </Button>
                    ),
                  },
                ]}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["vehicle"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Kendaraan - ${editing.vehicleNumber}` : "Tambah Kendaraan"}</DialogTitle>
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
              {/* Revise round 9 - physical cargo box dimensions in meters.
                  When all three are set, maxVolumeM3 is auto-computed as L × W × H
                  and the volume field below becomes read-only. */}
              <Field
                label="Ukuran - Panjang (m)"
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
                    ? "Auto-computed dari ukuran - clear ukuran untuk override manual."
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
              {/* Capacity Round — max koli (package count) limit. Optional:
                  empty = NOT CONFIGURED (capacity badge shows "Belum Dikonfigurasi"). */}
              <Field
                label="Max Koli (paket)"
                htmlFor="v-koli"
                hint="Batas jumlah paket. Kosongkan = tidak dikonfigurasi (informatif, tidak memblokir)."
              >
                <NumberInput
                  id="v-koli"
                  value={form.maxKoli}
                  onChange={(e) => setForm({ ...form, maxKoli: e.target.value })}
                  placeholder="60"
                  min="0"
                  step="1"
                  disabled={busy}
                />
              </Field>
              <Field label="Catatan" htmlFor="v-notes" className="sm:col-span-2">
                <Textarea id="v-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Opsional" disabled={busy} />
              </Field>
              {/* Revise.md §13 - link the vehicle to its Vehicle Owner */}
              <Field
                label="Vehicle Owner"
                htmlFor="v-owner"
                className="sm:col-span-2"
                hint="Kendaraan partner dihubungkan ke pemiliknya - profit share transport dibayarkan ke wallet owner."
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

      {/* Capacity history dialog (from the Kapasitas Armada tab). */}
      <VehicleCapacityHistoryDialog
        vehicleId={historyVehicle?.id ?? null}
        vehicleNumber={historyVehicle?.vehicleNumber ?? ""}
        open={historyVehicle != null}
        onOpenChange={(o) => !o && setHistoryVehicle(null)}
      />

      {/* Bulk-configure maxKoli confirmation (owner-only). */}
      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfigurasi Max Koli Otomatis?</AlertDialogTitle>
            <AlertDialogDescription>
              Ini akan mengisi <b>maxKoli</b> untuk kendaraan yang belum dikonfigurasi, dengan saran otomatis berdasarkan kapasitas berat:
              <span className="mt-1.5 block rounded-md bg-muted/50 px-2 py-1 text-[11px] font-mono">
                ≤1500kg → 40 · ≤3000kg → 60 · ≤6000kg → 100 · lainnya → 150
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={onBulkConfigure} disabled={bulkBusy}>
              <Wand2 className="h-3.5 w-3.5" /> Terapkan Otomatis
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FleetTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}
