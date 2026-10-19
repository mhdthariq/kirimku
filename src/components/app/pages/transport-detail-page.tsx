"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
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
  Printer,
  User,
  Users,
  Boxes,
  Coins,
  Info,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, hasPermission, type Transport, type TransportDetail, type TransportDropsBoard } from "@/infrastructure/http/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { DashboardMetric } from "@/components/app/dashboard-ui";
import { OperationalHeader } from "@/components/app/operational-ui";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { CheckpointCheckinDialog } from "@/components/app/checkpoint-checkin-dialog";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";
import { TransportDropsPanel } from "@/components/app/transport-drops-panel";
import { TransportActivitiesPanel } from "@/components/app/transport-activities-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransportExpensesPanel } from "@/components/app/transport-expenses-panel";
import { CapacityStatusCard } from "@/components/app/capacity-status-card";
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
  loading: () => <Skeleton className="h-85 w-full rounded-xl" />,
});

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="break-words text-sm font-medium leading-relaxed text-foreground">{value ?? "-"}</p>
      </div>
    </div>
  );
}

/**
 * Transport detail (Revision Part K):
 * 1. transport information  2. current location map  3. checkpoint check-in
 * info (photo evidence)  4. shipments with aggregate totals (Part L).
 * Checkpoint mode: arrival is
 * auto-detected when the crew checks in inside the final checkpoint's radius.
 * Checking in at the first checkpoint of a PLANNED transport automatically
 * marks it DEPARTED.
 */
export function TransportDetailPage({ transportId, initialTab }: { transportId: number; initialTab?: string }) {
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
  const { data: drops } = useApiData<TransportDropsBoard | null>(
    () => !transport || transport.trackingMode === "ACTIVITY"
      ? Promise.resolve(null)
      : apiGet<TransportDropsBoard>(`/transports/${transportId}/drops`),
    [transportId, transport?.id, transport?.trackingMode],
  );
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [confirmArrive, setConfirmArrive] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Revise round 9 — checkpoint photos dialog state. When the user clicks a
  // checkpoint record photo, we open the PhotoDetailDialog with all records
  // for that checkpoint so they can browse them at full size.
  const [photoRecords, setPhotoRecords] = useState<PhotoDetail[] | null>(null);

  const can = {
    checkin: hasPermission(user, "transport.checkin"),
    complete: hasPermission(user, "transport.complete"),
    // Edit & Remove are available for PLANNED transports only, gated on
    // transport.create (same rule as the list page + the API).
    manage: hasPermission(user, "transport.create"),
    // Multi drop / delivery approval / return task / expenses
    drop: hasPermission(user, "transport.arrive"),
    approve: hasPermission(user, "transport.delivery.approve"),
    createReturn: hasPermission(user, "return-task.create"),
    expenseView: hasPermission(user, "transport.expense.view"),
    expenseCreate: hasPermission(user, "transport.expense.create"),
    expenseUpdate: hasPermission(user, "transport.expense.update"),
    expenseDelete: hasPermission(user, "transport.expense.delete"),
  };

  const canAccessExpenses = can.expenseView || can.expenseCreate || can.expenseUpdate || can.expenseDelete;

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
          trackingMode: transport.trackingMode,
          transportMode: transport.transportMode,
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

  async function changeLifecycle(action: "depart" | "arrive" | "complete") {
    if (lifecycleBusy) return;
    setLifecycleBusy(true);
    const ok = await runAction(() => apiPost(`/transports/${transportId}/${action}`, {}), {
      success: action === "depart" ? "Transport berangkat." : action === "complete" ? "Audit dikonfirmasi. Transport Completed." : "Transport tiba, menunggu audit.",
    });
    setLifecycleBusy(false);
    if (ok) { setConfirmArrive(false); setConfirmComplete(false); void reload(); }
  }

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
        <Skeleton className="h-10 w-full max-w-72" />
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

  const isActivity = transport.trackingMode === "ACTIVITY";
  const assignedCrew = user?.employeeId != null && (transport.driver?.id === user.employeeId || transport.kenek?.id === user.employeeId);
  const driverFocused = isActivity && !!user?.roles.some((role) => role.slug === "driver" || role.slug === "kenek");
  const canAddActivity = can.checkin && assignedCrew && ["PLANNED", "DEPARTED"].includes(transport.status);
  const checkedInCount = mapCheckpoints.filter((c) => c.checkedIn).length;
  const allCheckedIn = mapCheckpoints.length > 0 && checkedInCount === mapCheckpoints.length;
  const pendingCheckpoints = mapCheckpoints.filter((c) => !c.checkedIn);
  // Check-in is available while the trip is PLANNED (the FIRST check-in
  // auto-departs it) or DEPARTED — ARRIVED/CANCELLED trips are closed.
  const canCheckinNow =
    !isActivity && can.checkin && isCrew && (transport.status === "PLANNED" || transport.status === "DEPARTED") && pendingCheckpoints.length > 0;

  // Vehicle Owners arrive from their own Transport History page — send them
  // back there instead of the staff transports list.
  const backHref = user?.partnerType === "VEHICLE_OWNER" ? "#/vo-transport-history" : "#/transports";
  const backLabel = user?.partnerType === "VEHICLE_OWNER" ? "Riwayat transport saya" : "Semua transport";

  return (
    <div className="dashboard-workspace transport-detail mx-auto min-w-0 max-w-[1600px] space-y-6 sm:space-y-8">
      <Button variant="ghost" size="sm" onClick={() => (window.location.hash = backHref)} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Button>

      <OperationalHeader
        icon={<Route className="h-5 w-5" />}
        eyebrow="Detail transport"
        title={transport.transportCode}
        description={`${transport.origin ?? "?"} → ${transport.destination ?? "?"} · ${transport.routeName ?? "tanpa rute"}`}
        actions={
          <div className="transport-actions flex max-w-full flex-wrap items-center gap-2">
            <StatusBadge status={transport.status} />
            {transport.status === "ARRIVED" && can.complete && (
              <Button size="sm" disabled={lifecycleBusy} onClick={() => setConfirmComplete(true)}>
                Audit & Konfirmasi Completed
              </Button>
            )}
            {drops?.transportMode === "MULTI_DROP" && <StatusBadge status="MULTI_DROP" label="Multi Drop" />}
            {isActivity && <StatusBadge status="ACTIVITY" label="Activity Tracking (Tanpa Checkpoint)" />}
            {isActivity && isCrew && transport.status === "PLANNED" && hasPermission(user, "transport.depart") && (
              <Button size="sm" disabled={lifecycleBusy} onClick={() => void changeLifecycle("depart")}>Berangkat</Button>
            )}
            {isActivity && isCrew && transport.status === "DEPARTED" && hasPermission(user, "transport.arrive") && (
              <Button size="sm" disabled={lifecycleBusy} onClick={() => setConfirmArrive(true)}>Tandai Tiba</Button>
            )}
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
            <Button size="sm" variant="outline" onClick={() => { window.location.hash = `#/transports/${transport.id}/manifest`; }}>
              <Printer className="h-3.5 w-3.5" /> Cetak Manifest
            </Button>
          </div>
        }
      />

      <section className="relative overflow-hidden rounded-2xl bg-[#008B75] p-5 text-white dark:bg-emerald-950 sm:p-7" aria-label="Ringkasan perjalanan">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[40px] border-emerald-400/10" />
        <div className="relative grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0"><p className="text-xs font-medium text-emerald-200">Koridor perjalanan</p><div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-3"><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-emerald-100/60">Asal</p><p className="mt-1 break-words text-lg font-semibold sm:text-2xl">{transport.origin ?? "—"}</p></div><Route className="mt-5 h-5 w-5 text-emerald-300" /><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-emerald-100/60">Tujuan</p><p className="mt-1 break-words text-lg font-semibold sm:text-2xl">{transport.destination ?? "—"}</p></div></div><p className="mt-4 break-words text-xs text-emerald-100/75">{isActivity ? "Activity tracking" : `${checkedInCount}/${mapCheckpoints.length} checkpoint ter-check-in`} · {formatNumber(transport.shipmentCount, 0)} shipment</p></div>
          <div className="grid min-w-0 gap-4 rounded-xl bg-white/5 p-4 sm:grid-cols-2"><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-emerald-100/60">Kendaraan</p><p className="mt-1 break-words text-sm font-semibold">{transport.vehicle.vehicleNumber}</p>{transport.vehicle.name && <p className="mt-1 break-words text-xs text-emerald-100/75">{transport.vehicle.name}</p>}</div><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-emerald-100/60">Driver</p><p className="mt-1 break-words text-sm font-semibold">{transport.driver?.name ?? "Belum ditugaskan"}</p>{transport.kenek?.name && <p className="mt-1 break-words text-xs text-emerald-100/75">Kenek: {transport.kenek.name}</p>}</div></div>
        </div>
      </section>
      {!driverFocused && <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardMetric label="Shipment" value={formatNumber(transport.shipmentCount, 0)} hint={`${formatNumber(transport.totalKoli ?? transport.shipments.reduce((sum, row) => sum + row.packages, 0), 0)} paket`} icon={<Boxes />} />
        <DashboardMetric label="Total Berat" value={`${formatNumber(transport.totalWeightKg, 1)} KG`} hint={transport.totalActualWeightKg != null ? `Aktual ${formatNumber(transport.totalActualWeightKg, 1)} KG` : undefined} icon={<Scale />} tone="blue" />
        <DashboardMetric label="Total Volume" value={`${formatNumber(transport.totalVolumeM3, 2)} M³`} icon={<PackageSearch />} tone="violet" />
        <DashboardMetric label="Total Price" value={formatRupiah(transport.totalPrice)} icon={<Coins />} tone="amber" />
      </div>}

      {transport.status === "ARRIVED" && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>Transport tiba — menunggu audit.</strong> Status masih ARRIVED, belum COMPLETED. Foto, shipment/paket, dan biaya operasional perlu ditinjau sebelum audit dikonfirmasi.
        </div>
      )}
      {transport.status === "COMPLETED" && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <p><strong>Transport COMPLETED — audit dikonfirmasi.</strong></p>
          <p>Reviewer: {transport.completedByUsername ?? "-"} · Role: {transport.completedByRole ?? "-"} · Waktu: {formatDate(transport.completedAt, true)}</p>
          <p>Approval paket dan biaya operasional tetap terpisah.</p>
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        {/* 1. Transport information */}
        <Card className={`min-w-0 rounded-2xl shadow-sm ${driverFocused ? "xl:col-span-2" : ""}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-primary" /> Informasi Transport
            </CardTitle>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-1">
            <InfoRow icon={<Route className="h-4 w-4" />} label="Rute" value={transport.routeName ?? "-"} />
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Koridor" value={`${transport.origin ?? "?"} → ${transport.destination ?? "?"}`} />
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Rencana berangkat" value={formatDate(transport.plannedDepartureAt, true)} />
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Rencana tiba" value={formatDate(transport.plannedArrivalAt, true)} />
            <InfoRow icon={<Truck className="h-4 w-4" />} label="Berangkat aktual" value={formatDate(transport.departedAt, true)} />
            <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Tiba aktual" value={formatDate(transport.arrivedAt, true)} />
            <InfoRow icon={<CarFront className="h-4 w-4" />} label="Kendaraan" value={`${transport.vehicle.vehicleNumber}${transport.vehicle.name ? ` - ${transport.vehicle.name}` : ""}`} />
            <InfoRow icon={<User className="h-4 w-4" />} label="Driver" value={transport.driver?.name ?? "-"} />
            <InfoRow icon={<Users className="h-4 w-4" />} label="Kenek" value={transport.kenek?.name ?? "-"} />
          </CardContent>
        </Card>

        {/* 2. Current location map */}
        {!driverFocused && <Card className="min-w-0 rounded-2xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-base">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> Posisi & Rute
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {transport.currentLatitude != null
                  ? `Posisi terakhir: ${formatDate(transport.lastLocationAt, true)}`
                  : isActivity ? "Belum ada posisi tercatat (menunggu aktivitas)" : "Belum ada posisi tercatat (menunggu check-in)"}
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
        </Card>}
      </div>

      <Tabs key={transport.id} defaultValue={initialTab === "expenses" && canAccessExpenses ? "expenses" : isActivity ? "activity" : "checkpoints"} className="min-w-0">
        <TabsList className="h-auto min-h-11 flex-wrap justify-start gap-1 rounded-xl p-1 sm:justify-start">
          <TabsTrigger value={isActivity ? "activity" : "checkpoints"}>{isActivity ? "Activity" : "Checkpoint"}</TabsTrigger>
          {canAccessExpenses && <TabsTrigger value="expenses">Biaya Operasional</TabsTrigger>}
        </TabsList>
        <TabsContent value={isActivity ? "activity" : "checkpoints"}>
      {isActivity ? (
        <TransportActivitiesPanel key={transport.id} transportId={transport.id} canCreate={canAddActivity} onChanged={reload} />
      ) : (
      <>
      {/* 3. Check-in information per checkpoint */}
      <Card className="min-w-0 rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-base">
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
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {mapCheckpoints.map((c) => {
                const records = transport.checkpointRecords.filter((r) => r.checkpointId === c.id);
                return (
                  <div key={c.id} className={`rounded-xl border p-3.5 ${c.checkedIn ? "border-emerald-300/70 dark:border-emerald-900" : ""}`}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {c.sequence}
                          </span>
                          <span className="break-words">{c.name}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Radius {formatNumber(c.radiusMeters / 1000, 2)} KM · <span className="font-mono">{c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}</span>
                        </p>
                        {/* Revise round 11 - Google Maps redirect button.
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
                          <div key={r.id} className="w-26 space-y-1">
                            {/* Revise round 9 - checkpoint record photo. Click opens
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
                              {r.recordedBy?.name ?? "-"}
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

      </>
      )}
        </TabsContent>
        {canAccessExpenses && (
          <TabsContent value="expenses">
            <TransportExpensesPanel transportId={transport.id} transportStatus={transport.status} canView={can.expenseView} canCreate={can.expenseCreate} canUpdate={can.expenseUpdate} canDelete={can.expenseDelete} />
          </TabsContent>
        )}
      </Tabs>

      {/* 3b. Multi drop board, delivery approval and return task. Re-mounted
          (key) whenever a check-in or status change happens so it refetches. */}
      {(!driverFocused || transport.transportMode === "MULTI_DROP") && <TransportDropsPanel
        key={`drops:${transport.status}:${transport.checkpointRecords.length}`}
        transportId={transport.id}
        isCrew={isCrew}
        can={{ assign: can.manage, drop: can.drop, approve: can.approve, createReturn: can.createReturn }}
        onChanged={reload}
      />}


      {/* 3d. Vehicle capacity status (Capacity Round) — informational, never blocks. */}
      {!driverFocused && transport.capacity && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="overflow-hidden border-l-4 border-l-primary/30">
            <CardContent className="pt-5">
              <CapacityStatusCard
                capacity={transport.capacity}
                vehicleNumber={transport.vehicle.vehicleNumber}
                vehicleName={transport.vehicle.name}
              />
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* 4. Shipments in transport + totals (Parts K/L) */}
      {!driverFocused && <Card className="min-w-0 rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Shipment dalam Transport
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 xl:hidden">
            {transport.shipments.map(shipment => <article key={shipment.id} className="min-w-0 space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><a className="break-all font-mono text-xs font-semibold text-primary" href={`/#/shipments/${shipment.id}`}>{shipment.masterCode}</a><StatusBadge status={shipment.status} /></div><p className="break-words text-sm font-medium">{shipment.customerName ?? "—"}</p>{shipment.penerimaName && <p className="break-words text-xs text-muted-foreground">Penerima: {shipment.penerimaName}</p>}<p className="break-words text-xs text-muted-foreground">Tujuan: {shipment.destination}</p><dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-3 text-xs"><div><dt className="text-muted-foreground">Paket</dt><dd className="mt-1 font-semibold">{formatNumber(shipment.packages, 0)}</dd></div><div><dt className="text-muted-foreground">Berat</dt><dd className="mt-1 break-words font-semibold">{formatNumber(shipment.weightKg, 1)} KG</dd></div><div><dt className="text-muted-foreground">Volume</dt><dd className="mt-1 break-words font-semibold">{formatNumber(shipment.volumeM3, 3)} M³</dd></div><div><dt className="text-muted-foreground">Harga</dt><dd className="mt-1 break-all font-semibold">{formatRupiah(shipment.priceAmount)}</dd></div></dl></article>)}
          </div>
          {/* shipments table */}
          {transport.shipments.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3.5 py-4 text-center text-sm text-muted-foreground">
              Belum ada shipment yang dimuat ke transport ini.
            </p>
          ) : (
            <div className="hidden min-w-0 overflow-x-auto rounded-xl border xl:block">
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
                        <p className="truncate text-xs font-medium text-foreground">{s.customerName ?? "-"}</p>
                        {s.penerimaName && <p className="text-[10px] text-muted-foreground">→ {s.penerimaName}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.destination}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.packages, 0)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.weightKg, 1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{formatNumber(s.volumeM3, 3)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{s.priceAmount != null ? formatRupiah(s.priceAmount) : "-"}</td>
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
                    <td className="px-3 py-2.5 text-right font-mono">{transport.totalPrice != null ? formatRupiah(transport.totalPrice) : "-"}</td>
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>}

      {transport.status === "ARRIVED" && allCheckedIn && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Transport ditandai <strong>ARRIVED</strong> otomatis melalui check-in checkpoint akhir (deteksi lokasi) - tanpa tombol manual.
        </p>
      )}

      {!isActivity && <CheckpointCheckinDialog
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
        transportId={transport.id}
        transportCode={transport.transportCode}
        checkpoints={mapCheckpoints}
        onDone={reload}
      />}

      <AlertDialog open={confirmArrive} onOpenChange={setConfirmArrive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tandai transport tiba?</AlertDialogTitle>
            <AlertDialogDescription>Transport akan ditandai ARRIVED dan menunggu audit, bukan COMPLETED. Setelah tiba, foto aktivitas baru tidak dapat ditambahkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={lifecycleBusy}>Batal</AlertDialogCancel>
            <Button disabled={lifecycleBusy} onClick={() => void changeLifecycle("arrive")}>{lifecycleBusy ? "Menyimpan…" : "Ya, tandai tiba"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {transport.status === "ARRIVED" && can.complete && (
        <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Konfirmasi audit transport?</AlertDialogTitle>
              <AlertDialogDescription>
                Pastikan Anda telah meninjau foto bukti perjalanan, shipment/paket, dan biaya operasional. Konfirmasi ini mengubah status ARRIVED menjadi COMPLETED serta mencatat reviewer dan waktu audit. Tidak ada approval paket atau biaya operasional otomatis; approval tersebut tetap dilakukan secara terpisah.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={lifecycleBusy}>Batal</AlertDialogCancel>
              <Button disabled={lifecycleBusy} onClick={() => void changeLifecycle("complete")}>
                {lifecycleBusy ? "Menyimpan…" : "Ya, konfirmasi audit"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Edit - shared create/edit dialog (PLANNED transports only) */}
      <TransportFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={editingTransport}
        onSaved={reload}
      />

      {/* Remove - confirmation dialog (PLANNED transports only) */}
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

      {/* Revise round 9 - Photo Detail Dialog for checkpoint records.
          Opens when the user clicks a checkpoint photo thumbnail. Shows
          all photos for that checkpoint at full size, gated by proof_photo.view. */}
      <PhotoDetailDialog
        open={!!photoRecords}
        onOpenChange={(open) => !open && setPhotoRecords(null)}
        title={`Foto Bukti Checkpoint - ${transport?.transportCode ?? ""}`}
        description="Foto bukti check-in driver/kenek di setiap checkpoint sepanjang rute transport."
        photos={photoRecords ?? []}
      />

    </div>
  );
}
