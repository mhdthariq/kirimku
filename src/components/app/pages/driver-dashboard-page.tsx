"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  Camera,
  CarFront,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  Package,
  PackageSearch,
  Route,
  Scale,
  Truck,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, type Checkpoint } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { DatePeriodFilter } from "@/components/app/date-period-filter";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { CheckpointCheckinDialog } from "@/components/app/checkpoint-checkin-dialog";
import type { TransportMapCheckpoint } from "@/components/app/transport-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const TransportMap = dynamic(() => import("@/components/app/transport-map").then((m) => m.TransportMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-xl" />,
});

export interface DriverTransportSummary {
  id: number;
  transportCode: string;
  status: string;
  routeName: string | null;
  origin: string | null;
  destination: string | null;
  plannedDepartureAt: string | null;
  plannedArrivalAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  vehicleNumber: string;
  vehicleName: string | null;
  maxWeightKg: number;
  maxVolumeM3: number;
  driverName: string | null;
  kenekName: string | null;
  shipmentCount: number;
  packageCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  totalPrice: number | null;
  checkpointsTotal: number;
  checkpointsCheckedIn: number;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
  lastCheckpointName: string | null;
  lastCheckinAt: string | null;
  lastCheckinBy: string | null;
  nextCheckpoint: Pick<Checkpoint, "id" | "name" | "sequence" | "latitude" | "longitude" | "radiusMeters"> | null;
}

interface DriverDashboardData {
  period: { from: string; to: string };
  current: DriverTransportSummary | null;
  upcoming: DriverTransportSummary[];
  future: DriverTransportSummary[];
  completedCount: number;
  history: DriverTransportSummary[];
  totalTransportsAllTime: number;
  note?: string;
}

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TransportMiniCard({ t, actionLabel = "Buka" }: { t: DriverTransportSummary; actionLabel?: string }) {
  return (
    <a
      href={`#/transports/${t.id}`}
      className="block rounded-xl border bg-card p-3.5 transition hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="font-mono text-xs text-primary">{t.transportCode}</span>
            <span className="truncate">{t.origin ?? "?"} → {t.destination ?? "?"}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><CarFront className="h-3 w-3" /> {t.vehicleNumber}</span>
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {t.driverName ?? "—"}</span>
            {t.kenekName && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {t.kenekName}</span>}
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDate(t.plannedDepartureAt, true)}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Boxes className="h-3 w-3" /> {formatNumber(t.shipmentCount, 0)} shipment</span>
            <span className="flex items-center gap-1"><Scale className="h-3 w-3" /> {formatNumber(t.totalWeightKg, 1)} KG</span>
            <span className="flex items-center gap-1"><PackageSearch className="h-3 w-3" /> {formatNumber(t.totalVolumeM3, 2)} M³</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={t.status} />
          <span className="flex items-center gap-1 text-xs font-semibold text-primary">
            {actionLabel} <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </a>
  );
}

/**
 * Driver / Kenek operational dashboard (Revision Parts T & U):
 * 1. current transport (+ position map, vehicle, crew, current/next checkpoint)
 * 2. vehicle information
 * 3. current checkpoint with the selfie check-in action
 * 4. upcoming + 5. future planned transports (from Transport Planning)
 * 6. transport history summary within the selected period (date filter)
 * Only transports assigned to THIS driver/kenek are ever returned.
 */
export function DriverDashboard() {
  const { user } = useAuth();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [checkinOpen, setCheckinOpen] = useState(false);

  const { data, loading, reload } = useApiData<DriverDashboardData>(
    () => apiGet<DriverDashboardData>(`/dashboard/driver?from=${from}&to=${to}`),
    [from, to],
  );

  const greeting = new Date().getHours() < 12 ? "Selamat pagi" : new Date().getHours() < 18 ? "Selamat siang" : "Selamat malam";

  // map data for the current transport (route from the detail endpoint is not
  // needed here — position + next checkpoint markers are enough)
  const mapCheckpoints: TransportMapCheckpoint[] = useMemo<TransportMapCheckpoint[]>(() => {
    const c = data?.current;
    if (!c?.nextCheckpoint) return [];
    return [
      {
        ...c.nextCheckpoint,
        routeId: 0,
        isActive: true,
        checkedIn: false,
        latestRecordAt: null,
        latestBy: null,
      },
    ];
  }, [data?.current]);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        </div>
      </div>
    );
  }

  const { current, upcoming, future, completedCount, history } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {greeting}, {user?.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground">Dashboard operasional driver — transport yang ditugaskan kepada Anda.</p>
        </div>
        <DatePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {data.note && (
        <p className="rounded-lg border border-amber-300 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{data.note}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1. Current transport */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Route className="h-4 w-4 text-primary" /> Transport Berjalan
              </span>
              {current ? <StatusBadge status={current.status} /> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!current ? (
              <p className="rounded-lg border border-dashed px-3.5 py-8 text-center text-sm text-muted-foreground">
                Tidak ada transport yang sedang berjalan.
                {upcoming.length > 0 ? ` Transport berikutnya: ${upcoming[0].transportCode} (${formatDate(upcoming[0].plannedDepartureAt, true)}).` : ""}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <a href={`#/transports/${current.id}`} className="font-mono text-sm font-bold text-primary hover:underline">
                      {current.transportCode}
                    </a>
                    <p className="text-sm font-medium text-foreground">
                      {current.origin ?? "?"} → {current.destination ?? "?"} · {current.routeName ?? "—"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => (window.location.hash = `#/transports/${current.id}`)}>
                    <ArrowRight className="h-3.5 w-3.5" /> Buka Transport
                  </Button>
                </div>

                {/* current position map */}
                <TransportMap
                  checkpoints={mapCheckpoints}
                  height={240}
                  currentPosition={
                    current.currentLatitude != null && current.currentLongitude != null
                      ? { latitude: current.currentLatitude, longitude: current.currentLongitude, recordedAt: current.lastLocationAt }
                      : null
                  }
                  checkins={[]}
                  fitTo="position"
                />

                {/* 3. Current checkpoint + check-in action */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                        <MapPin className="h-3.5 w-3.5" /> Checkpoint Berikutnya
                      </p>
                      <p className="mt-1 text-sm font-bold text-foreground">
                        {current.nextCheckpoint
                          ? `#${current.nextCheckpoint.sequence} ${current.nextCheckpoint.name}`
                          : "Semua checkpoint sudah ter-check-in"}
                      </p>
                      {current.nextCheckpoint && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Radius validasi {formatNumber(current.nextCheckpoint.radiusMeters / 1000, 2)} KM ·{" "}
                          <span className="font-mono">{current.nextCheckpoint.latitude.toFixed(5)}, {current.nextCheckpoint.longitude.toFixed(5)}</span>
                        </p>
                      )}
                      {current.lastCheckinAt && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Check-in terakhir: {current.lastCheckpointName} · {formatDate(current.lastCheckinAt, true)}
                          {current.lastCheckinBy ? ` oleh ${current.lastCheckinBy}` : ""}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Progress checkpoint: {current.checkpointsCheckedIn}/{current.checkpointsTotal} ter-check-in
                      </p>
                    </div>
                    {current.nextCheckpoint && (
                      <Button onClick={() => setCheckinOpen(true)} className="shrink-0">
                        <Camera className="h-4 w-4" /> Check-in Selfie
                      </Button>
                    )}
                  </div>
                </div>

                {/* aggregates of current transport */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Shipment</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{formatNumber(current.shipmentCount, 0)}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Berat</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{formatNumber(current.totalWeightKg, 1)} KG</p>
                  </div>
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Volume</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{formatNumber(current.totalVolumeM3, 2)} M³</p>
                  </div>
                  <div className="rounded-xl border bg-muted/40 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Harga</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{current.totalPrice != null ? formatRupiah(current.totalPrice) : "—"}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Vehicle information */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CarFront className="h-4 w-4 text-primary" /> Kendaraan & Kru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!current ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada kendaraan aktif — muncul saat transport berjalan.</p>
            ) : (
              <div className="divide-y divide-border/60 text-sm">
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><Truck className="h-4 w-4" /> Nomor Polisi</span>
                  <span className="font-mono font-bold text-foreground">{current.vehicleNumber}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><Package className="h-4 w-4" /> Kendaraan</span>
                  <span className="font-medium text-foreground">{current.vehicleName ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><Scale className="h-4 w-4" /> Kapasitas</span>
                  <span className="text-foreground">{formatNumber(current.maxWeightKg, 0)} KG · {formatNumber(current.maxVolumeM3, 2)} M³</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><User className="h-4 w-4" /> Driver</span>
                  <span className="font-medium text-foreground">{current.driverName ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><Users className="h-4 w-4" /> Kenek</span>
                  <span className="font-medium text-foreground">{current.kenekName ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4" /> Berangkat</span>
                  <span className="font-medium text-foreground">{formatDate(current.departedAt, true)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4/5. Upcoming & future transports */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Transport Berikutnya (Upcoming)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">Belum ada transport terjadwal.</p>
            ) : (
              upcoming.map((t) => <TransportMiniCard key={t.id} t={t} />)
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarIcon /> Transport Mendatang (Future)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {future.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">Tidak ada transport mendatang.</p>
            ) : (
              future.map((t) => <TransportMiniCard key={t.id} t={t} />)
            )}
          </CardContent>
        </Card>
      </div>

      {/* 6. Transport history summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Riwayat Transport
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {completedCount} transport selesai dalam periode · total sepanjang waktu {data.totalTransportsAllTime}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">
              Belum ada transport selesai pada periode {formatDate(from)} → {formatDate(to)}.
            </p>
          ) : (
            history.map((t) => <TransportMiniCard key={t.id} t={t} actionLabel="Riwayat" />)
          )}
          <a href="#/transport-history" className="flex items-center justify-center gap-1 pt-1 text-xs font-semibold text-primary hover:underline">
            Lihat semua riwayat transport <ArrowRight className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      {/* check-in dialog for the current transport's next checkpoint */}
      {current && (
        <CheckpointCheckinDialog
          open={checkinOpen}
          onOpenChange={setCheckinOpen}
          transportId={current.id}
          transportCode={current.transportCode}
          checkpoints={mapCheckpoints}
          onDone={reload}
        />
      )}
    </div>
  );
}

function CalendarIcon() {
  return <CheckCircle2 className="h-4 w-4 text-primary" />;
}
