"use client";

import { AlertTriangle, Box, Boxes, Gauge, Package, Scale, ShieldCheck } from "lucide-react";
import type {
  CapacityState,
  CapacityStatus,
  OverallCapacityState,
  TransportCapacityStatus,
} from "@/infrastructure/http/client-api";
import { calculateTransportCapacityStatus, type TransportLoad, type VehicleCapacity } from "@/domain/capacity";
import { cn } from "@/shared/utils";
import { formatNumber } from "@/components/app/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Status → visual mapping (shared by every capacity surface)
// ---------------------------------------------------------------------------

const STATE_STYLES: Record<CapacityState, { badge: string; dot: string; bar: string; label: string }> = {
  OK: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    label: "OK",
  },
  WARNING: {
    badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/50 dark:text-orange-300",
    dot: "bg-orange-500",
    bar: "bg-orange-500",
    label: "Hampir Penuh",
  },
  OVERLIMIT: {
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    label: "Over Limit",
  },
  UNCONFIGURED: {
    badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
    dot: "bg-amber-500",
    bar: "bg-amber-400",
    label: "Belum Dikonfigurasi",
  },
};

const OVERALL_STYLES: Record<OverallCapacityState, { badge: string; label: string; icon: typeof ShieldCheck }> = {
  OK: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
    label: "Aman",
    icon: ShieldCheck,
  },
  WARNING: {
    badge: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/50 dark:text-orange-300",
    label: "Hampir Penuh",
    icon: AlertTriangle,
  },
  OVERLIMIT: {
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300",
    label: "Over Kapasitas",
    icon: AlertTriangle,
  },
  PARTIALLY_CONFIGURED: {
    badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
    label: "Sebagian Tak Terkonfigurasi",
    icon: Gauge,
  },
  UNCONFIGURED: {
    badge: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400",
    label: "Belum Dikonfigurasi",
    icon: Gauge,
  },
};

export function CapacityStateBadge({ state, className }: { state: CapacityState; className?: string }) {
  const s = STATE_STYLES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.badge,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function OverallCapacityBadge({ state, className }: { state: OverallCapacityState; className?: string }) {
  const s = OVERALL_STYLES[state];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        s.badge,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One dimension row (Weight / Volume / Koli)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capacity utilization donut ring — visual overall indicator.
// Shows the WORST (max) utilization % across the configured dimensions, tinted
// by the overall status. SVG so it stays crisp + animates on update.
// ---------------------------------------------------------------------------

export function CapacityRing({
  capacity,
  size = 56,
}: {
  capacity: TransportCapacityStatus;
  size?: number;
}) {
  // Max utilization across configured dimensions = how "full" the vehicle is
  // at its most-loaded dimension. Null utilizations (UNCONFIGURED) are skipped.
  const utils = [capacity.weight, capacity.volume, capacity.koli]
    .map((d) => d.utilizationPercent)
    .filter((u): u is number => u != null);
  const maxUtil = utils.length > 0 ? Math.max(...utils) : 0;

  const stroke = Math.max(3, size * 0.08);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Cap the arc at 100% visually (overlimit = full ring, tinted rose).
  const pct = Math.min(maxUtil, 100);
  const offset = c - (pct / 100) * c;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={cn("transition-all duration-500", ringColorClass(capacity.overallStatus))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-sm font-bold tabular-nums leading-none", textColorClass(capacity.overallStatus))}>
          {Math.round(maxUtil)}%
        </span>
        <span className="text-[7px] font-medium uppercase tracking-wide text-muted-foreground">max</span>
      </div>
    </div>
  );
}

function ringColorClass(state: OverallCapacityState): string {
  switch (state) {
    case "OK":
      return "stroke-emerald-500";
    case "WARNING":
      return "stroke-orange-500";
    case "OVERLIMIT":
      return "stroke-rose-500";
    case "PARTIALLY_CONFIGURED":
      return "stroke-amber-500";
    case "UNCONFIGURED":
      return "stroke-zinc-400";
  }
}
function textColorClass(state: OverallCapacityState): string {
  switch (state) {
    case "OK":
      return "text-emerald-600 dark:text-emerald-400";
    case "WARNING":
      return "text-orange-600 dark:text-orange-400";
    case "OVERLIMIT":
      return "text-rose-600 dark:text-rose-400";
    case "PARTIALLY_CONFIGURED":
      return "text-amber-600 dark:text-amber-400";
    case "UNCONFIGURED":
      return "text-zinc-500";
  }
}

interface DimensionRowProps {
  icon: React.ReactNode;
  label: string;
  unit: string;
  digits: number;
  status: CapacityStatus;
}

function DimensionRow({ icon, label, unit, digits, status }: DimensionRowProps) {
  const style = STATE_STYLES[status.status];
  const pct = status.utilizationPercent ?? 0;
  // Cap the bar at 100% visually but tint red when over.
  const barWidth = Math.min(pct, 100);
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <CapacityStateBadge state={status.status} />
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-lg font-bold tabular-nums text-foreground">
          {formatNumber(status.current, digits)}
        </span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {status.maximum != null ? formatNumber(status.maximum, digits) : "—"}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">{unit}</span>
      </div>

      {/* utilization bar — only when configured */}
      {status.maximum != null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", style.bar)}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      ) : (
        <div className="mt-2 h-1.5 w-full rounded-full border border-dashed border-muted-foreground/30" />
      )}

      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        {status.status === "OVERLIMIT" ? (
          <span className="font-medium text-rose-600 dark:text-rose-400">
            Over {formatNumber(status.overBy ?? 0, digits)} {unit}
          </span>
        ) : status.status === "WARNING" ? (
          <span className="font-medium text-orange-600 dark:text-orange-400">
            Sisa {formatNumber(status.remaining ?? 0, digits)} {unit} · hampir penuh
          </span>
        ) : status.status === "OK" ? (
          <span className="font-medium text-muted-foreground">
            Sisa {formatNumber(status.remaining ?? 0, digits)} {unit}
          </span>
        ) : (
          <span className="font-medium text-amber-600 dark:text-amber-400">Limit belum diset</span>
        )}
        {status.utilizationPercent != null && (
          <span
            className={cn(
              "tabular-nums font-semibold",
              status.status === "OVERLIMIT" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
            )}
          >
            {formatNumber(status.utilizationPercent, 1)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full capacity card — used on the transport detail page
// ---------------------------------------------------------------------------

export function CapacityStatusCard({
  capacity,
  vehicleNumber,
  vehicleName,
  className,
}: {
  capacity: TransportCapacityStatus;
  vehicleNumber?: string;
  vehicleName?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Kapasitas Kendaraan</p>
            <p className="text-[11px] text-muted-foreground">
              {vehicleNumber ? vehicleNumber : "Kendaraan"}
              {vehicleName ? ` · ${vehicleName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <CapacityRing capacity={capacity} size={52} />
          <OverallCapacityBadge state={capacity.overallStatus} />
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <DimensionRow
          icon={<Scale className="h-3.5 w-3.5" />}
          label="Berat"
          unit="KG"
          digits={1}
          status={capacity.weight}
        />
        <DimensionRow
          icon={<Box className="h-3.5 w-3.5" />}
          label="Volume"
          unit="M³"
          digits={2}
          status={capacity.volume}
        />
        <DimensionRow
          icon={<Package className="h-3.5 w-3.5" />}
          label="Koli"
          unit="koli"
          digits={0}
          status={capacity.koli}
        />
      </div>

      <div className="flex items-start gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Status kapasitas bersifat <span className="font-semibold">informatif</span> — operator tetap
          dapat menugaskan resi meskipun kendaraan over limit. Berat dihitung dari berat aktual (bukan
          chargeable), volume dari kubikasi (L×W×H), koli dari jumlah paket.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact summary — for the transport list rows (no card chrome)
// ---------------------------------------------------------------------------

export function CapacitySummaryInline({ capacity, showRing = false }: { capacity: TransportCapacityStatus; showRing?: boolean }) {
  const dims: { label: string; state: CapacityState }[] = [
    { label: "B", state: capacity.weight.status },
    { label: "V", state: capacity.volume.status },
    { label: "K", state: capacity.koli.status },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {showRing && <CapacityRing capacity={capacity} size={28} />}
      <OverallCapacityBadge state={capacity.overallStatus} className="!px-1.5 !py-0 !text-[10px]" />
      <div className="hidden items-center gap-1 sm:flex">
        {dims.map((d) => (
          <span
            key={d.label}
            title={d.label === "B" ? "Berat" : d.label === "V" ? "Volume" : "Koli"}
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold",
              STATE_STYLES[d.state].badge,
            )}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview — transport create/edit form: projects the selected vehicle's
// capacity against the shipments the operator has checked. Pure client-side
// (reuses the shared calculateTransportCapacityStatus). Non-blocking.
// ---------------------------------------------------------------------------

export interface PreviewShipment {
  id: number;
  totals?: { totalActualKg: number; totalVolumeM3: number; totalPackages: number } | null;
}

export function TransportFormCapacityPreview({
  vehicle,
  selectedShipments,
}: {
  vehicle: { vehicleNumber: string; name?: string | null; maxWeightKg: number; maxVolumeM3?: number; maxKoli?: number | null } | null;
  selectedShipments: PreviewShipment[];
}) {
  if (!vehicle) return null;

  const load: TransportLoad = selectedShipments.reduce(
    (acc, s) => {
      const t = s.totals;
      acc.totalActualWeightKg += t?.totalActualKg ?? 0;
      acc.totalVolumeM3 += t?.totalVolumeM3 ?? 0;
      acc.totalKoli += t?.totalPackages ?? 0;
      return acc;
    },
    { totalActualWeightKg: 0, totalVolumeM3: 0, totalKoli: 0 },
  );

  const vehicleCap: VehicleCapacity = {
    maxWeightKg: vehicle.maxWeightKg,
    maxVolumeM3: vehicle.maxVolumeM3 ?? null,
    maxKoli: vehicle.maxKoli ?? null,
  };
  const capacity = calculateTransportCapacityStatus(vehicleCap, load);

  const rows: { label: string; icon: typeof Scale; unit: string; digits: number; s: CapacityStatus }[] = [
    { label: "Berat", icon: Scale, unit: "KG", digits: 1, s: capacity.weight },
    { label: "Volume", icon: Box, unit: "M³", digits: 2, s: capacity.volume },
    { label: "Koli", icon: Package, unit: "koli", digits: 0, s: capacity.koli },
  ];

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" />
          Preview Kapasitas
          <span className="font-normal text-muted-foreground">
            · {vehicle.vehicleNumber}{vehicle.name ? ` ${vehicle.name}` : ""}
          </span>
        </div>
        <OverallCapacityBadge state={capacity.overallStatus} className="!text-[10px]" />
      </div>

      {selectedShipments.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Pilih shipment untuk melihat proyeksi beban kendaraan.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {rows.map(({ label, icon: Icon, unit, digits, s }) => {
            const style = STATE_STYLES[s.status];
            return (
              <div key={label} className="rounded-lg border bg-card px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className="h-2.5 w-2.5" />{label}
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                </div>
                <p className="mt-0.5 text-xs font-bold tabular-nums text-foreground">
                  {formatNumber(s.current, digits)}
                  <span className="text-muted-foreground">/</span>
                  <span className="font-medium tabular-nums text-muted-foreground">
                    {s.maximum != null ? formatNumber(s.maximum, digits) : "—"}
                  </span>
                </p>
                <p className={cn("text-[9px] font-medium", s.status === "OVERLIMIT" ? "text-rose-600 dark:text-rose-400" : s.status === "WARNING" ? "text-orange-600 dark:text-orange-400" : s.status === "UNCONFIGURED" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                  {s.status === "OVERLIMIT"
                    ? `Over ${formatNumber(s.overBy ?? 0, digits)} ${unit}`
                    : s.status === "WARNING"
                      ? `Sisa ${formatNumber(s.remaining ?? 0, digits)} ${unit}`
                      : s.status === "OK"
                        ? `Sisa ${formatNumber(s.remaining ?? 0, digits)} ${unit}`
                        : "Limit belum diset"}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Preview informatif — operator tetap dapat menyimpan transport meskipun over limit.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fleet capacity widget — dashboard overview of active transports' capacity.
// ---------------------------------------------------------------------------

export function FleetCapacityWidget({
  summary,
}: {
  summary: {
    activeTransports: number;
    overCapacityTransports: number;
    warningTransports: number;
    partiallyConfiguredTransports: number;
    vehiclesOverWeight: number;
    vehiclesOverVolume: number;
    vehiclesOverKoli: number;
  } | null;
}) {
  if (!summary) return null;
  const { activeTransports, overCapacityTransports, warningTransports, partiallyConfiguredTransports, vehiclesOverWeight, vehiclesOverVolume, vehiclesOverKoli } = summary;
  const healthy = activeTransports - overCapacityTransports - warningTransports - partiallyConfiguredTransports;
  const hasIssues = overCapacityTransports > 0 || warningTransports > 0 || partiallyConfiguredTransports > 0;
  // Fleet health = % of active transports that are fully OK (not over/warning/partial).
  const healthyPct = activeTransports > 0 ? Math.round((healthy / activeTransports) * 100) : 100;
  const fleetState: OverallCapacityState = overCapacityTransports > 0 ? "OVERLIMIT" : warningTransports > 0 ? "WARNING" : partiallyConfiguredTransports > 0 ? "PARTIALLY_CONFIGURED" : "OK";

  // Fleet ring — same SVG donut as CapacityRing but shows fleet health %.
  const size = 64;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(healthyPct, 100) / 100) * c;

  return (
    <Card className="overflow-hidden border-l-4 border-l-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><Gauge className="h-4 w-4" /></span>
            Kapasitas Armada
          </CardTitle>
          {/* Fleet health ring */}
          <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className={cn("transition-all duration-500", ringColorClass(fleetState))} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-sm font-bold tabular-nums leading-none", textColorClass(fleetState))}>{healthyPct}%</span>
              <span className="text-[7px] font-medium uppercase tracking-wide text-muted-foreground">sehat</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Status beban {activeTransports} transport aktif (PLANNED + DEPARTED) — informatif, tidak memblokir operasi.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall split bar — rose (over) + orange (warning) + amber (partial) + emerald (ok) */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          {overCapacityTransports > 0 && (
            <div className="bg-rose-500" style={{ width: `${(overCapacityTransports / Math.max(activeTransports, 1)) * 100}%` }} title={`${overCapacityTransports} over capacity`} />
          )}
          {warningTransports > 0 && (
            <div className="bg-orange-500" style={{ width: `${(warningTransports / Math.max(activeTransports, 1)) * 100}%` }} title={`${warningTransports} hampir penuh`} />
          )}
          {partiallyConfiguredTransports > 0 && (
            <div className="bg-amber-400" style={{ width: `${(partiallyConfiguredTransports / Math.max(activeTransports, 1)) * 100}%` }} title={`${partiallyConfiguredTransports} partially configured`} />
          )}
          {healthy > 0 && (
            <div className="bg-emerald-500" style={{ width: `${(healthy / Math.max(activeTransports, 1)) * 100}%` }} title={`${healthy} aman`} />
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg border bg-emerald-50/50 px-2 py-2 dark:bg-emerald-950/20">
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{healthy}</p>
            <p className="text-[10px] font-medium text-muted-foreground">Aman</p>
          </div>
          <div className="rounded-lg border bg-orange-50/50 px-2 py-2 dark:bg-orange-950/20">
            <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{warningTransports}</p>
            <p className="text-[10px] font-medium text-muted-foreground">Hampir</p>
          </div>
          <div className="rounded-lg border bg-amber-50/50 px-2 py-2 dark:bg-amber-950/20">
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{partiallyConfiguredTransports}</p>
            <p className="text-[10px] font-medium text-muted-foreground">Sebagian</p>
          </div>
          <div className="rounded-lg border bg-rose-50/50 px-2 py-2 dark:bg-rose-950/20">
            <p className="text-lg font-bold text-rose-600 dark:text-rose-400">{overCapacityTransports}</p>
            <p className="text-[10px] font-medium text-muted-foreground">Over</p>
          </div>
        </div>

        {/* Per-dimension overlimit breakdown — with % of active fleet over-limit */}
        <div className="grid grid-cols-3 gap-2">
          <DimensionOverChip icon={<Scale className="h-3 w-3" />} label="Berat" count={vehiclesOverWeight} total={activeTransports} unit="kendaraan" />
          <DimensionOverChip icon={<Box className="h-3 w-3" />} label="Volume" count={vehiclesOverVolume} total={activeTransports} unit="kendaraan" />
          <DimensionOverChip icon={<Package className="h-3 w-3" />} label="Koli" count={vehiclesOverKoli} total={activeTransports} unit="kendaraan" />
        </div>

        {hasIssues ? (
          <p className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            {overCapacityTransports > 0 && <><b>{overCapacityTransports}</b> transport over kapasitas. </>}
            Operator tetap dapat melanjutkan — status ini bersifat informatif.
          </p>
        ) : (
          <p className="flex items-center gap-1 rounded-lg border border-emerald-300/60 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> Semua transport aktif dalam batas kapasitas.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DimensionOverChip({ icon, label, count, total, unit }: { icon: React.ReactNode; label: string; count: number; total: number; unit: string }) {
  const over = count > 0;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={cn("rounded-lg border px-2 py-1.5 text-center", over ? "border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20" : "bg-muted/30")}>
      <div className="flex items-center justify-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <p className={cn("mt-0.5 text-sm font-bold tabular-nums", over ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>{count}</p>
      {/* mini progress bar showing % of active fleet over-limit on this dimension */}
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", over ? "bg-rose-500" : "bg-emerald-400")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[9px] text-muted-foreground">{pct}% {unit}</p>
    </div>
  );
}
