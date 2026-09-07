"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Calculator,
  CheckCircle2,
  MapPin,
  MapPinned,
  Package,
  Pencil,
  Plus,
  Scale,
  Truck,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, apiPut, hasPermission, type Transport, type Options, type Shipment, type TransportDetail } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, SubmitButton, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TransportMap = dynamic(
  () => import("@/components/app/transport-map").then((m) => m.TransportMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[420px] w-full rounded-xl" />,
  },
);

interface TransportForm {
  routeId: string;
  vehicleId: string;
  driverId: string;
  kenekId: string;
  shipmentIds: number[];
  notes: string;
}

const EMPTY: TransportForm = { routeId: "", vehicleId: "", driverId: "", kenekId: "", shipmentIds: [], notes: "" };

export function TransportsPage({ transportId }: { transportId: number | null }) {
  return transportId != null ? <TransportDetailView id={transportId} /> : <TransportList />;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function TransportList() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "transport.view"),
    create: hasPermission(user, "transport.create"),
    depart: hasPermission(user, "transport.depart"),
    arrive: hasPermission(user, "transport.arrive"),
  };

  const { data, loading, reload } = useApiData<Transport[]>(() => apiGet<Transport[]>("/transports"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [readyShipments, setReadyShipments] = useState<Shipment[]>([]);

  useEffect(() => {
    if (!can.create) return;
    apiGet<Shipment[]>("/shipments?status=RECEIVED_AT_GUDANG")
      .then(setReadyShipments)
      .catch(() => undefined);
  }, [can.create, data]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transport | null>(null);
  const [form, setForm] = useState<TransportForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Transport | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (!q ||
          t.transportCode.toLowerCase().includes(q) ||
          (t.routeName ?? "").toLowerCase().includes(q) ||
          t.vehicleNumber.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(t: Transport) {
    setEditing(t);
    setForm({
      routeId: t.routeId ? String(t.routeId) : "",
      vehicleId: String(t.vehicleId),
      driverId: "",
      kenekId: "",
      shipmentIds: [],
      notes: "",
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload: Record<string, unknown> = {
      routeId: Number(form.routeId),
      vehicleId: Number(form.vehicleId),
    };
    if (form.driverId) payload.driverId = Number(form.driverId);
    if (form.kenekId) payload.kenekId = Number(form.kenekId);
    if (!editing && form.shipmentIds.length > 0) payload.shipmentIds = form.shipmentIds;
    const ok = await runAction(
      () => (editing ? apiPut(`/transports/${editing.id}`, payload) : apiPost("/transports", payload)),
      { success: editing ? "Transport diperbarui." : "Transport dibuat." },
    );
    setBusy(false);
    if (ok) {
      setDialogOpen(false);
      reload();
    }
  }

  async function onDepart(t: Transport) {
    const ok = await runAction(() => apiPost(`/transports/${t.id}/depart`), { success: `${t.transportCode} berangkat.` });
    if (ok) reload();
  }

  async function onArrive(t: Transport) {
    const ok = await runAction(() => apiPost(`/transports/${t.id}/arrive`), { success: `${t.transportCode} tiba di tujuan.` });
    if (ok) reload();
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/transports/${target.id}`), { success: "Transport dihapus." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="Transports" subtitle="Anda tidak memiliki izin melihat transport." />;
  }

  const employeeOptions = (options?.employees ?? []).map((e) => ({ value: String(e.id), label: `${e.name}${e.position ? ` — ${e.position}` : ""}` }));
  const routeOptions = (options?.routes ?? []).map((r) => ({ value: String(r.id), label: r.name }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transports"
        subtitle="Perjalanan linehaul antar gudang mengikuti rute checkpoint — klik kode untuk posisi & muatan."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Buat Transport
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
            searchPlaceholder="Cari kode / rute / nopol…"
            toolbar={
              <div className="flex items-center gap-1.5">
                {["all", "PLANNED", "DEPARTED", "ARRIVED"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === "all" ? "Semua" : s}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada transport. Klik “Buat Transport” untuk menjadwalkan linehaul."
            columns={[
              {
                key: "code",
                header: "Kode",
                primary: true,
                render: (t) => (
                  <div>
                    <a href={`#/transports/${t.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                      {t.transportCode}
                    </a>
                    <p className="text-xs text-muted-foreground">{t.vehicleNumber}</p>
                  </div>
                ),
              },
              {
                key: "route",
                header: "Rute",
                render: (t) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.routeName ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.shipments.length} shipment · {formatNumber(t.summary?.totalActualWeightKg ?? 0)} kg ·{" "}
                      {formatNumber(t.summary?.totalPieces ?? 0)} koli
                    </p>
                  </div>
                ),
              },
              {
                key: "crew",
                header: "Kru",
                hideOnMobile: true,
                render: (t) => (
                  <span className="text-sm text-muted-foreground">
                    {t.driverName ?? "—"}{t.kenekName ? ` · ${t.kenekName}` : ""}
                  </span>
                ),
              },
              {
                key: "position",
                header: "Posisi",
                hideOnMobile: true,
                render: (t) => {
                  if (t.status === "PLANNED") return <span className="text-xs text-muted-foreground">Belum berangkat</span>;
                  const passed = t.progress?.passedCheckpoints ?? 0;
                  const total = t.progress?.totalCheckpoints ?? 0;
                  return (
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {passed}/{total} checkpoint
                      </p>
                      {t.progress?.lastRecordAt && (
                        <p className="text-[11px] text-muted-foreground">update {formatDate(t.progress.lastRecordAt, true)}</p>
                      )}
                    </div>
                  );
                },
              },
              { key: "departedAt", header: "Depart", hideOnMobile: true, render: (t) => formatDate(t.departedAt, true) },
              { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (t) => (
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => (window.location.hash = `#/transports/${t.id}`)}>
                      <MapPin className="h-3.5 w-3.5" /> Detail
                    </Button>
                    {t.status === "PLANNED" && can.depart && (
                      <Button size="sm" className="h-7" onClick={() => onDepart(t)}>
                        <Truck className="h-3.5 w-3.5" /> Depart
                      </Button>
                    )}
                    {t.status === "DEPARTED" && can.arrive && (
                      <Button size="sm" variant="secondary" className="h-7" onClick={() => onArrive(t)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Arrive
                      </Button>
                    )}
                    {t.status === "PLANNED" && can.create && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} aria-label={`Edit ${t.transportCode}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(t)} aria-label={`Hapus ${t.transportCode}`}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["transport"]} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Transport — ${editing.transportCode}` : "Buat Transport"}</DialogTitle>
            <DialogDescription>
              {editing ? "Hanya transport PLANNED yang bisa diubah." : "Pilih rute (wajib ≥ 3 checkpoint), kendaraan, kru, dan shipment yang dimuat."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rute" htmlFor="t-route">
                <FormSelect value={form.routeId} onValueChange={(v) => setForm({ ...form, routeId: v })} placeholder="Pilih rute" options={routeOptions} disabled={busy} />
              </Field>
              <Field label="Kendaraan" htmlFor="t-vehicle">
                <FormSelect
                  value={form.vehicleId}
                  onValueChange={(v) => setForm({ ...form, vehicleId: v })}
                  placeholder="Pilih kendaraan aktif"
                  options={(options?.vehicles ?? []).map((v) => ({ value: String(v.id), label: `${v.vehicleNumber}${v.name ? ` — ${v.name}` : ""}` }))}
                  disabled={busy}
                />
              </Field>
              <Field label="Driver" htmlFor="t-driver">
                <FormSelect value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })} placeholder="Pilih driver" options={employeeOptions} disabled={busy} />
              </Field>
              <Field label="Kenek" htmlFor="t-kenek">
                <FormSelect value={form.kenekId} onValueChange={(v) => setForm({ ...form, kenekId: v })} placeholder="Pilih kenek" options={employeeOptions} disabled={busy} />
              </Field>
            </div>

            {!editing && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Muat shipment (status RECEIVED_AT_GUDANG)</p>
                {readyShipments.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3.5 py-3 text-sm text-muted-foreground">
                    Tidak ada shipment siap dimuat saat ini — transport tetap bisa dibuat kosong.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                    {readyShipments.map((s) => (
                      <label key={s.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={form.shipmentIds.includes(s.id)}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              shipmentIds: e.target.checked ? [...f.shipmentIds, s.id] : f.shipmentIds.filter((id) => id !== s.id),
                            }))
                          }
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                        <span className="font-mono text-xs font-semibold">{s.masterCode}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {s.customer?.name} · {s.destination}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>{editing ? "Simpan Perubahan" : "Buat Transport"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus transport {confirmDelete?.transportCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Hanya transport berstatus PLANNED yang bisa dihapus. Shipment yang belum berangkat akan dikembalikan ke status RECEIVED_AT_GUDANG.
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

// ---------------------------------------------------------------------------
// Detail view — position on map, load stats, shipments in this transport
// ---------------------------------------------------------------------------

function TransportDetailView({ id }: { id: number }) {
  const { user } = useAuth();
  const can = {
    depart: hasPermission(user, "transport.depart"),
    arrive: hasPermission(user, "transport.arrive"),
    recordCheckpoint: hasPermission(user, "transport.record_checkpoint"),
  };

  const [transport, setTransport] = useState<TransportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<TransportDetail>(`/transports/${id}`);
      setTransport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat transport.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !transport) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/transports")} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">
          {error ?? "Transport tidak ditemukan."}
        </p>
      </div>
    );
  }

  const { summary, progress, vehicle, checkpoints, shipments, checkpointRecords, route } = transport;
  const nextCpId = progress.nextCheckpoint?.id ?? null;
  const capacityPct =
    vehicle.maxWeightKg > 0 ? Math.min(100, Math.round((summary.totalActualWeightKg / vehicle.maxWeightKg) * 100)) : 0;

  async function onDepart() {
    const ok = await runAction(() => apiPost(`/transports/${transport!.id}/depart`), {
      success: `${transport!.transportCode} berangkat.`,
    });
    if (ok) load();
  }

  async function onArrive() {
    const ok = await runAction(() => apiPost(`/transports/${transport!.id}/arrive`), {
      success: `${transport!.transportCode} tiba di tujuan.`,
    });
    if (ok) load();
  }

  async function onRecordCheckpoint(cpId: number, cpName: string) {
    setBusy(true);
    const ok = await runAction(() => apiPost(`/transports/${transport!.id}/checkpoints`, { checkpointId: cpId }), {
      success: `Posisi tercatat: kendaraan melewati ${cpName}.`,
    });
    setBusy(false);
    if (ok) load();
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => (window.location.hash = "#/transports")} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Semua transport
      </Button>

      <PageHeader
        title={transport.transportCode}
        subtitle={`${route?.name ?? "Tanpa rute"}${route?.origin && route?.destination ? ` · ${route.origin} → ${route.destination}` : ""} · ${vehicle.vehicleNumber}${vehicle.name ? ` (${vehicle.name})` : ""} · kru: ${transport.driverName ?? "—"}${transport.kenekName ? ` & ${transport.kenekName}` : ""}`}
        actions={
          <>
            <StatusBadge status={transport.status} />
            {transport.status === "PLANNED" && can.depart && (
              <Button onClick={onDepart}>
                <Truck className="h-4 w-4" /> Depart
              </Button>
            )}
            {transport.status === "DEPARTED" && can.arrive && (
              <Button variant="secondary" onClick={onArrive}>
                <CheckCircle2 className="h-4 w-4" /> Arrive
              </Button>
            )}
          </>
        }
      />

      {/* Load stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Package} label="Shipment dimuat" value={`${summary.shipmentCount}`} sub={`${formatNumber(summary.totalPieces)} koli · ${formatNumber(summary.totalVolumeM3, 2)} m³`} />
        <StatCard icon={Scale} label="Berat aktual" value={`${formatNumber(summary.totalActualWeightKg)} kg`} sub={`volumetrik ${formatNumber(summary.totalVolumetricWeightKg)} kg`} />
        <StatCard icon={Calculator} label="Chargeable" value={summary.totalChargeableWeightKg > 0 ? `${formatNumber(summary.totalChargeableWeightKg)} kg` : "—"} sub={`nilai ${formatRupiah(summary.totalValueRp)}`} />
        <StatCard icon={MapPinned} label="Checkpoint dilewati" value={`${progress.passedCheckpoints}/${progress.totalCheckpoints}`} sub={`${checkpointRecords.length} catatan posisi`} />
      </div>

      {/* Position + route map */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinned className="h-4 w-4 text-primary" /> Posisi & Rute Perjalanan
            </CardTitle>
            <p className="max-w-full text-xs text-muted-foreground sm:max-w-md sm:text-right">
              {progress.currentPosition.label}
              {progress.currentPosition.recordedAt ? ` · update ${formatDate(progress.currentPosition.recordedAt, true)}` : ""}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {checkpoints.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">
              Rute transport ini tidak memiliki checkpoint — posisi kendaraan tidak bisa dilacak.
            </p>
          ) : (
            <>
              <TransportMap
                checkpoints={checkpoints}
                records={checkpointRecords}
                currentPosition={progress.currentPosition}
                vehicleNumber={vehicle.vehicleNumber}
              />
              <div className="grid gap-1.5">
                {checkpoints.map((cp) => (
                  <div key={cp.id} className="flex items-center gap-3 rounded-lg border bg-card px-3.5 py-2.5">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary-foreground ${
                        cp.passed ? "bg-primary" : "bg-muted-foreground/70"
                      }`}
                      aria-hidden
                    >
                      {cp.sequence}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {cp.name}
                        {cp.id === nextCpId && (
                          <Badge variant="outline" className="ml-2 border-primary/40 text-[10px] text-primary">
                            berikutnya
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {cp.passed
                          ? `Dilewati ${cp.lastRecordAt ? formatDate(cp.lastRecordAt, true) : "—"}`
                          : cp.id === nextCpId
                            ? "Kendaraan sedang menuju checkpoint ini"
                            : "Belum dilewati"}{" "}
                        · radius {formatNumber(cp.radiusMeters, 0)} m
                      </p>
                    </div>
                    {transport.status === "DEPARTED" && can.recordCheckpoint && !cp.passed && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0"
                        disabled={busy}
                        onClick={() => onRecordCheckpoint(cp.id, cp.name)}
                      >
                        <MapPin className="h-3.5 w-3.5" /> Catat Posisi
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Load summary + capacity */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4 text-primary" /> Ringkasan Muatan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Jumlah shipment" value={`${summary.shipmentCount}`} />
            <Row label="Total koli (pieces)" value={`${formatNumber(summary.totalPieces)}`} />
            <Row label="Berat aktual" value={`${formatNumber(summary.totalActualWeightKg)} kg`} />
            <Row label="Berat volumetrik (÷6000)" value={`${formatNumber(summary.totalVolumetricWeightKg)} kg`} />
            <Row label="Chargeable weight" value={summary.totalChargeableWeightKg > 0 ? `${formatNumber(summary.totalChargeableWeightKg)} kg` : "—"} />
            <Row label="Volume total" value={`${formatNumber(summary.totalVolumeM3, 2)} m³`} />
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5">
              <span className="text-xs font-semibold text-primary">NILAI MUATAN</span>
              <span className="text-base font-bold text-primary">{formatRupiah(summary.totalValueRp)}</span>
            </div>
            <div className="pt-1">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Kapasitas berat {vehicle.vehicleNumber}</span>
                <span className="font-semibold text-foreground">
                  {formatNumber(summary.totalActualWeightKg)} / {formatNumber(vehicle.maxWeightKg)} kg ({capacityPct}%)
                </span>
              </div>
              <Progress value={capacityPct} className="h-2" aria-label="Utilisasi kapasitas berat kendaraan" />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Volume {formatNumber(summary.totalVolumeM3, 2)} / {formatNumber(vehicle.maxVolumeM3, 2)} m³
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Position history */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-primary" /> Riwayat Posisi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {checkpointRecords.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada catatan posisi. Kru/ops dapat mencatat posisi di setiap checkpoint saat transport DEPARTED.
              </p>
            ) : (
              <ol className="relative ml-2 space-y-0 border-l pl-5">
                {checkpointRecords.map((r) => (
                  <li key={r.id} className="relative pb-4 last:pb-0">
                    <span
                      className={`absolute -left-[23px] top-1 flex h-2.5 w-2.5 rounded-full border-2 border-card ${
                        r.withinRadius ? "bg-primary" : "bg-muted-foreground/60"
                      }`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-foreground">{r.checkpointName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        CP {r.sequence}/{progress.totalCheckpoints} · {formatDate(r.recordedAt, true)}
                      </span>
                      {r.withinRadius ? (
                        <Badge className="text-[10px]">valid</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          di luar radius
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      oleh {r.recordedByName ?? "—"} · <span className="font-mono text-[11px]">{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Shipments on this transport */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Shipment Dimuat ({shipments.length}) — klik resi untuk detail lengkap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={shipments}
            emptyMessage="Belum ada shipment yang dimuat ke transport ini."
            columns={[
              {
                key: "code",
                header: "Resi",
                primary: true,
                render: (s) => (
                  <a href={`#/shipments/${s.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {s.masterCode}
                  </a>
                ),
              },
              {
                key: "customer",
                header: "Customer & Rute",
                render: (s) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.customerName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.origin} → {s.destination}
                    </p>
                  </div>
                ),
              },
              {
                key: "load",
                header: "Muatan",
                render: (s) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{formatNumber(s.pieces)} koli</p>
                    <p className="text-[11px] text-muted-foreground">{s.detailsCount} detail barang</p>
                  </div>
                ),
              },
              {
                key: "weight",
                header: "Berat",
                render: (s) => (
                  <div>
                    <p className="text-sm font-semibold text-foreground">{formatNumber(s.actualWeightKg)} kg</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.chargeableWeightKg != null ? `chargeable ${formatNumber(s.chargeableWeightKg)} kg` : "belum dihitung"}
                    </p>
                  </div>
                ),
              },
              {
                key: "price",
                header: "Harga",
                hideOnMobile: true,
                render: (s) => (s.priceAmount != null ? <span className="font-semibold">{formatRupiah(s.priceAmount)}</span> : "—"),
              },
              { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
              {
                key: "actions",
                header: "Aksi",
                render: (s) => (
                  <Button variant="outline" size="sm" className="h-7" onClick={() => (window.location.hash = `#/shipments/${s.id}`)}>
                    Detail
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <ActivityLogPanel entityTypes={["transport"]} title="Log Aktivitas Transport Ini" limit={20} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {label}
        </p>
        <p className="mt-1.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

