"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Calendar,
  Camera,
  CarFront,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Package,
  PackageCheck,
  PackageSearch,
  Pencil,
  Route,
  Scale,
  Truck,
  User,
  Users,
  Boxes,
  Coins,
  Info,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, hasPermission, type Transport, type TransportDetail } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { CheckpointCheckinDialog } from "@/components/app/checkpoint-checkin-dialog";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";
import { PhotoDetailDialog, type PhotoDetail } from "@/components/app/photo-detail-dialog";
import type { TransportMapCheckpoint } from "@/components/app/transport-map";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TransportMap = dynamic(() => import("@/components/app/transport-map").then((m) => m.TransportMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[340px] w-full rounded-xl" />,
});

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value ?? "—"}</p>
      </div>
    </div>
  );
}

/**
 * Transport detail (Revision Part K):
 * 1. transport information  2. current location map  3. checkpoint check-in
 * info (photo evidence)  4. shipments with aggregate totals (Part L).
 * Part N: there is deliberately NO manual "Arrived" button — arrival is
 * auto-detected when the crew checks in inside the final checkpoint's radius.
 * Checking in at the first checkpoint of a PLANNED transport automatically
 * marks it DEPARTED.
 */
export function TransportDetailPage({ transportId }: { transportId: number }) {
  const { user } = useAuth();
  // Revise round 8 — Proof photo viewing is permission-gated. Only Admin
  // Gudang + Owner see the actual checkpoint photo thumbnails; other roles
  // see a "foto terkunci" placeholder so they still know a photo exists but
  // cannot view the image itself.
  const canViewProofPhotos = hasPermission(user, "proof_photo.view");
  const { data: transport, loading, reload } = useApiData<TransportDetail>(
    () => apiGet<TransportDetail>(`/transports/${transportId}`),
    [transportId],
  );
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Revise round 9 — checkpoint photos dialog state. When the user clicks a
  // checkpoint record photo, we open the PhotoDetailDialog with all records
  // for that checkpoint so they can browse them at full size.
  const [photoRecords, setPhotoRecords] = useState<PhotoDetail[] | null>(null);

  const can = {
    checkin: hasPermission(user, "transport.checkin"),
    // Edit & Remove are available for PLANNED transports only, gated on
    // transport.create (same rule as the list page + the API).
    manage: hasPermission(user, "transport.create"),
  };

  async function onDelete() {
    setConfirmDelete(false);
    const ok = await runAction(() => apiDelete(`/transports/${transportId}`), { success: "Transport dihapus." });
    if (ok) window.location.hash = "#/transports";
  }

  // TransportDetail → the Transport-ish shape the shared edit dialog expects.
  const editingTransport: Transport | null =
    transport && transport.status === "PLANNED"
      ? {
          id: transport.id,
          transportCode: transport.transportCode,
          status: transport.status,
          routeId: transport.routeId,
          routeName: transport.routeName,
          vehicleId: transport.vehicle.id,
          vehicleNumber: transport.vehicle.vehicleNumber,
          vehicleName: transport.vehicle.name,
          driverName: transport.driver?.name ?? null,
          kenekName: transport.kenek?.name ?? null,
          origin: transport.origin,
          destination: transport.destination,
          plannedDepartureAt: transport.plannedDepartureAt,
          plannedArrivalAt: transport.plannedArrivalAt,
          departedAt: transport.departedAt,
          arrivedAt: transport.arrivedAt,
          createdAt: transport.createdAt,
          currentLatitude: transport.currentLatitude,
          currentLongitude: transport.currentLongitude,
          lastLocationAt: transport.lastLocationAt,
          shipments: [],
          checkpointRecordsCount: transport.checkpointRecords.length,
          shipmentCount: transport.shipmentCount,
          totalWeightKg: transport.totalWeightKg,
          totalVolumeM3: transport.totalVolumeM3,
          totalPrice: transport.totalPrice,
        }
      : null;

  // is the signed-in user part of this transport's crew (driver/kenek)?
  const isCrew = useMemo(() => {
    if (!transport || !user) return false;
    if (user.isOwner) return true;
    const meEmployee = user.employeeId;
    return (
      (transport.driver?.id != null && transport.driver.id === meEmployee) ||
      (transport.kenek?.id != null && transport.kenek.id === meEmployee)
    );
  }, [transport, user]);

  // checkpoints with check-in state (latest record per checkpoint)
  const mapCheckpoints: TransportMapCheckpoint[] = useMemo(() => {
    if (!transport) return [];
    const latestByCheckpoint = new Map<number, TransportDetail["checkpointRecords"][number]>();
    for (const r of transport.checkpointRecords) {
      const prev = latestByCheckpoint.get(r.checkpointId);
      if (!prev || new Date(r.recordedAt) > new Date(prev.recordedAt)) latestByCheckpoint.set(r.checkpointId, r);
    }
    return transport.checkpoints.map((c) => {
      const rec = latestByCheckpoint.get(c.id);
      return {
        ...c,
        checkedIn: rec != null,
        latestRecordAt: rec?.recordedAt ?? null,
        latestBy: rec?.recordedBy?.name ?? null,
      };
    });
  }, [transport]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-1" />
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!transport) {
    return (
      <div className="space-y-4">
        <PageHeader title="Transport tidak ditemukan" subtitle="Mungkin dihapus atau Anda tidak memiliki akses." icon={<Route className="h-5 w-5" />} />
        <Button variant="outline" onClick={() => (window.location.hash = user?.partnerType === "VEHICLE_OWNER" ? "#/vo-transport-history" : "#/transports")}>
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
      </div>
    );
  }

  const checkedInCount = mapCheckpoints.filter((c) => c.checkedIn).length;
  const allCheckedIn = mapCheckpoints.length > 0 && checkedInCount === mapCheckpoints.length;
  const pendingCheckpoints = mapCheckpoints.filter((c) => !c.checkedIn);
  // Check-in is available while the trip is PLANNED (the FIRST check-in
  // auto-departs it) or DEPARTED — ARRIVED/CANCELLED trips are closed.
  const canCheckinNow =
    can.checkin && isCrew && (transport.status === "PLANNED" || transport.status === "DEPARTED") && pendingCheckpoints.length > 0;

  // Vehicle Owners arrive from their own Transport History page — send them
  // back there instead of the staff transports list.
  const backHref = user?.partnerType === "VEHICLE_OWNER" ? "#/vo-transport-history" : "#/transports";
  const backLabel = user?.partnerType === "VEHICLE_OWNER" ? "Riwayat transport saya" : "Semua transport";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => (window.location.hash = backHref)} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Button>

      <PageHeader
        title={transport.transportCode}
        subtitle={`${transport.origin ?? "?"} → ${transport.destination ?? "?"} · ${transport.routeName ?? "tanpa rute"}`}
        icon={<Route className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={transport.status} />
            {canCheckinNow && (
              <Button size="sm" onClick={() => setCheckinOpen(true)}>
                <Camera className="h-3.5 w-3.5" /> Check-in Checkpoint
              </Button>
            )}
            {transport.status === "PLANNED" && can.manage && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {transport.status === "PLANNED" && can.manage && (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <XCircle className="h-3.5 w-3.5" /> Hapus
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1. Transport information */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" /> Informasi Transport
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            <InfoRow icon={<Route className="h-4 w-4" />} label="Rute" value={transport.routeName ?? "—"} />
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Koridor" value={`${transport.origin ?? "?"} → ${transport.destination ?? "?"}`} />
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Rencana berangkat" value={formatDate(transport.plannedDepartureAt, true)} />
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Rencana tiba" value={formatDate(transport.plannedArrivalAt, true)} />
            <InfoRow icon={<Truck className="h-4 w-4" />} label="Berangkat aktual" value={formatDate(transport.departedAt, true)} />
            <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Tiba aktual" value={formatDate(transport.arrivedAt, true)} />
            <InfoRow icon={<CarFront className="h-4 w-4" />} label="Kendaraan" value={`${transport.vehicle.vehicleNumber}${transport.vehicle.name ? ` — ${transport.vehicle.name}` : ""}`} />
            <InfoRow icon={<User className="h-4 w-4" />} label="Driver" value={transport.driver?.name ?? "—"} />
            <InfoRow icon={<Users className="h-4 w-4" />} label="Kenek" value={transport.kenek?.name ?? "—"} />
          </CardContent>
        </Card>

        {/* 2. Current location map */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> Posisi & Rute
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {transport.currentLatitude != null
                  ? `Posisi terakhir: ${formatDate(transport.lastLocationAt, true)}`
                  : "Belum ada posisi tercatat (menunggu check-in)"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TransportMap
              checkpoints={mapCheckpoints}
              currentPosition={
                transport.currentLatitude != null && transport.currentLongitude != null
                  ? { latitude: transport.currentLatitude, longitude: transport.currentLongitude, recordedAt: transport.lastLocationAt }
                  : null
              }
              checkins={transport.checkpointRecords.map((r) => ({ latitude: r.latitude, longitude: r.longitude, recordedAt: r.recordedAt }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* 3. Check-in information per checkpoint */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" /> Check-in Checkpoint
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {checkedInCount}/{mapCheckpoints.length} checkpoint ter-check-in
              {transport.status === "PLANNED" && " · check-in pertama otomatis menandai transport DEPARTED (berangkat)"}
              {transport.status === "DEPARTED" && " · tiba terdeteksi otomatis saat check-in checkpoint akhir"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mapCheckpoints.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Rute belum memiliki checkpoint.</p>
          ) : (
            <div className="grid gap-2.5 md:grid-cols-2">
              {mapCheckpoints.map((c) => {
                const records = transport.checkpointRecords.filter((r) => r.checkpointId === c.id);
                return (
                  <div key={c.id} className={`rounded-xl border p-3.5 ${c.checkedIn ? "border-emerald-300/70 dark:border-emerald-900" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {c.sequence}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Radius {formatNumber(c.radiusMeters / 1000, 2)} KM · <span className="font-mono">{c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}</span>
                        </p>
                        {/* Revise round 11 — Google Maps redirect button.
                            Opens Google Maps at this checkpoint's coordinate in a new tab. */}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary transition hover:border-primary/60 hover:bg-primary/10"
                          title={`Buka ${c.name} di Google Maps`}
                        >
                          <ExternalLink className="h-3 w-3" /> Buka di Google Maps
                        </a>
                      </div>
                      {c.checkedIn ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <PackageCheck className="h-3 w-3" /> Checked In
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Belum</span>
                      )}
                    </div>
                    {records.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {records.slice(0, 4).map((r) => (
                          <div key={r.id} className="w-[104px] space-y-1">
                            {/* Revise round 9 — checkpoint record photo. Click opens
                                the PhotoDetailDialog (full-size view). Display is
                                gated by proof_photo.view (Admin Gudang + Owner). */}
                            <button
                              type="button"
                              onClick={() =>
                                setPhotoRecords(
                                  records.map((rec) => ({
                                    url: rec.photoUrl ?? "",
                                    label: `${r.checkpointName} · CP ${r.checkpointSequence}`,
                                    recordedAt: rec.recordedAt,
                                    recordedBy: rec.recordedBy?.name ?? null,
                                  })),
                                )
                              }
                              className="block w-full"
                              title={r.photoUrl ? "Klik untuk lihat foto lebih besar" : "Belum ada foto"}
                            >
                              {r.photoUrl ? (
                                canViewProofPhotos ? (
                                  <img src={r.photoUrl} alt={`Bukti ${r.checkpointName}`} className="h-16 w-full rounded-md border object-cover" />
                                ) : (
                                  <div
                                    className="flex h-16 w-full flex-col items-center justify-center gap-1 rounded-md border bg-muted/60 px-1 text-center text-[9px] font-medium text-muted-foreground"
                                    title="Foto bukti hanya dapat dilihat oleh Admin Gudang / Owner (proof_photo.view)"
                                  >
                                    <Camera className="h-4 w-4" />
                                    foto terkunci
                                  </div>
                                )
                              ) : (
                                <div className="flex h-16 w-full items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">tanpa foto</div>
                              )}
                            </button>
                            <p className="text-[10px] leading-tight text-muted-foreground">
                              {new Date(r.recordedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              <br />
                              {r.recordedBy?.name ?? "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Shipments in transport + totals (Parts K/L) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Shipment dalam Transport
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* aggregate totals */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Boxes className="h-3.5 w-3.5" /> Shipment
              </p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(transport.shipmentCount, 0)}</p>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Scale className="h-3.5 w-3.5" /> Total Berat
              </p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(transport.totalWeightKg, 1)} <span className="text-xs font-medium text-muted-foreground">KG</span></p>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <PackageSearch className="h-3.5 w-3.5" /> Total Volume
              </p>
              <p className="mt-1 text-xl font-bold text-foreground">{formatNumber(transport.totalVolumeM3, 2)} <span className="text-xs font-medium text-muted-foreground">M³</span></p>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Coins className="h-3.5 w-3.5" /> Total Price
              </p>
              <p className="mt-1 text-xl font-bold text-foreground">
                {transport.totalPrice != null ? formatRupiah(transport.totalPrice) : "—"}
              </p>
            </div>
          </div>

          {/* shipments table */}
          {transport.shipments.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3.5 py-4 text-center text-sm text-muted-foreground">
              Belum ada shipment yang dimuat ke transport ini.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5">Master Resi</th>
                    <th className="px-3 py-2.5">Customer / Penerima</th>
                    <th className="px-3 py-2.5">Tujuan</th>
                    <th className="px-3 py-2.5 text-right">Paket</th>
                    <th className="px-3 py-2.5 text-right">Berat (KG)</th>
                    <th className="px-3 py-2.5 text-right">Volume (M³)</th>
                    <th className="px-3 py-2.5 text-right">Harga</th>
                    <th className="px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transport.shipments.map((s) => (
                    <tr key={s.id} className="border-b transition hover:bg-accent/40">
                      <td className="px-3 py-2.5">
                        <a href={`#/shipments/${s.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                          {s.masterCode}
                        </a>
                        {s.resi && s.resi !== s.masterCode && <p className="text-[10px] text-muted-foreground">{s.resi}</p>}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="truncate text-xs font-medium text-foreground">{s.customerName ?? "—"}</p>
                        {s.penerimaName && <p className="text-[10px] text-muted-foreground">→ {s.penerimaName}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.destination}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.packages, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.weightKg, 1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.volumeM3, 3)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{s.priceAmount != null ? formatRupiah(s.priceAmount) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          status={s.status}
                          label={
                            s.status === "ARRIVED_AT_GUDANG"
                              ? `Arrived at ${s.arrivedWarehouseName ?? s.destinationWarehouseName ?? s.destination}`
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 text-xs font-semibold">
                    <td className="px-3 py-2.5" colSpan={3}>TOTAL ({transport.shipmentCount} shipment)</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatNumber(transport.shipments.reduce((s, x) => s + x.packages, 0), 0)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatNumber(transport.totalWeightKg, 1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatNumber(transport.totalVolumeM3, 3)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{transport.totalPrice != null ? formatRupiah(transport.totalPrice) : "—"}</td>
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {transport.status === "ARRIVED" && allCheckedIn && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Transport ditandai <strong>ARRIVED</strong> otomatis melalui check-in checkpoint akhir (deteksi lokasi) — tanpa tombol manual.
        </p>
      )}

      <CheckpointCheckinDialog
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
        transportId={transport.id}
        transportCode={transport.transportCode}
        checkpoints={mapCheckpoints}
        onDone={reload}
      />

      {/* Edit — shared create/edit dialog (PLANNED transports only) */}
      <TransportFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={editingTransport}
        onSaved={reload}
      />

      {/* Remove — confirmation dialog (PLANNED transports only) */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus transport {transport.transportCode}?</AlertDialogTitle>
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

      {/* Revise round 9 — Photo Detail Dialog for checkpoint records.
          Opens when the user clicks a checkpoint photo thumbnail. Shows
          all photos for that checkpoint at full size, gated by proof_photo.view. */}
      <PhotoDetailDialog
        open={!!photoRecords}
        onOpenChange={(open) => !open && setPhotoRecords(null)}
        title={`Foto Bukti Checkpoint — ${transport?.transportCode ?? ""}`}
        description="Foto bukti check-in driver/kenek di setiap checkpoint sepanjang rute transport."
        photos={photoRecords ?? []}
      />
    </div>
  );
}
