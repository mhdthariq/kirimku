"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Gauge, GaugeCircle, History, PackageMinus, Scale, Box, Package, Truck, AlertTriangle, ShieldCheck, Search, Wand2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type FleetCapacityResponse, type FleetCapacityRow } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { CapacityRing, OverallCapacityBadge } from "@/components/app/capacity-status-card";
import { VehicleCapacityHistoryDialog } from "@/components/app/vehicle-capacity-history-dialog";
import { formatNumber } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

/**
 * Fleet Capacity overview (Capacity Round) — a dedicated page showing every
 * vehicle with its capacity config and the LIVE capacity status of the cargo
 * currently on its active (PLANNED + DEPARTED) transports.
 *
 * Informational only — never blocks operations. Gated on `vehicle.view`.
 */
export function FleetCapacityPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "vehicle.view");
  const { data, loading, reload } = useApiData<FleetCapacityResponse>(() => apiGet<FleetCapacityResponse>("/fleet-capacity"), []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "over" | "warning" | "partial" | "ok" | "idle">("all");
  const [historyVehicle, setHistoryVehicle] = useState<{ id: number; vehicleNumber: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const rows = useMemo(() => {
    const list = data?.vehicles ?? [];
    const q = search.toLowerCase();
    return list.filter((v) => {
      if (q && !v.vehicleNumber.toLowerCase().includes(q) && !(v.name ?? "").toLowerCase().includes(q)) return false;
      if (statusFilter === "all") return true;
      if (statusFilter === "idle") return v.activeCapacity == null;
      if (statusFilter === "over") return v.activeCapacity?.overallStatus === "OVERLIMIT";
      if (statusFilter === "warning") return v.activeCapacity?.overallStatus === "WARNING";
      if (statusFilter === "partial") return v.activeCapacity?.overallStatus === "PARTIALLY_CONFIGURED";
      if (statusFilter === "ok") return v.activeCapacity?.overallStatus === "OK";
      return true;
    });
  }, [data, search, statusFilter]);

  function exportCsv() {
    if (!data) return;
    const header = [
      "nopol", "nama", "status", "max_berat_kg", "max_volume_m3", "max_koli",
      "owner", "active_transport", "overall", "berat_status", "volume_status", "koli_status",
      "berat_current_kg", "volume_current_m3", "koli_current",
    ];
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = data.vehicles.map((v) => [
      v.vehicleNumber, v.name ?? "", v.status, v.maxWeightKg, v.maxVolumeM3, v.maxKoli ?? "",
      v.ownerName ?? "", v.activeTransportCount,
      v.activeCapacity?.overallStatus ?? "", v.activeCapacity?.weight.status ?? "", v.activeCapacity?.volume.status ?? "", v.activeCapacity?.koli.status ?? "",
      v.activeLoad?.totalActualWeightKg ?? "", v.activeLoad?.totalVolumeM3 ?? "", v.activeLoad?.totalKoli ?? "",
    ].map(esc).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fleet-capacity-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
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
    if (ok) reload();
  }

  if (!canView) {
    return <PageHeader title="Kapasitas Armada" subtitle="Anda tidak memiliki izin melihat kendaraan." icon={<Gauge className="h-5 w-5" />} />;
  }

  const summary = data?.summary;
  const healthyPct = summary && summary.active > 0 ? Math.round((summary.ok / summary.active) * 100) : 100;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kapasitas Armada"
        subtitle="Overview kapasitas seluruh kendaraan — konfigurasi limit + beban live dari transport aktif (PLANNED + DEPARTED). Informatif, tidak memblokir."
        icon={<Gauge className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data?.vehicles.length}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {user?.isOwner && (summary?.unconfiguredVehicles ?? 0) > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)} disabled={bulkBusy}>
                <Wand2 className="h-4 w-4" /> Konfigurasi Otomatis ({summary?.unconfiguredVehicles})
              </Button>
            )}
          </>
        }
      />

      {/* Summary tiles */}
      {summary && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile icon={<Truck className="h-4 w-4" />} label="Total Armada" value={summary.total} />
          <SummaryTile icon={<GaugeCircle className="h-4 w-4" />} label="Aktif" value={summary.active} accent="text-primary" />
          <SummaryTile icon={<ShieldCheck className="h-4 w-4" />} label="Aman" value={summary.ok} accent="text-emerald-600 dark:text-emerald-400" />
          <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} label="Hampir Penuh" value={summary.warning} accent="text-orange-600 dark:text-orange-400" />
          <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} label="Over" value={summary.overCapacity} accent="text-rose-600 dark:text-rose-400" />
          <SummaryTile icon={<Gauge className="h-4 w-4" />} label="Sebagian" value={summary.partiallyConfigured} accent="text-amber-600 dark:text-amber-400" />
          <SummaryTile icon={<PackageMinus className="h-4 w-4" />} label="Koli Belum Diset" value={summary.unconfiguredVehicles} accent="text-muted-foreground" />
        </motion.div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nopol / nama…"
            className="h-9 w-56 pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ["all", "Semua"],
            ["ok", "Aman"],
            ["warning", "Hampir"],
            ["over", "Over"],
            ["partial", "Sebagian"],
            ["idle", "Idle"],
          ] as const).map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant={statusFilter === k ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setStatusFilter(k)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyMessage="Tidak ada kendaraan yang cocok."
        columns={[
          {
            key: "vehicle",
            header: "Kendaraan",
            primary: true,
            render: (v) => (
              <div className="flex items-center gap-2.5">
                <CapacityRingMini row={v} />
                <div>
                  <p className="font-mono text-xs font-semibold text-foreground">{v.vehicleNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{v.name ?? "-"}</p>
                  {v.ownerName && <p className="text-[10px] text-muted-foreground">owner: {v.ownerName}</p>}
                </div>
              </div>
            ),
          },
          {
            key: "config",
            header: "Konfigurasi Limit",
            render: (v) => (
              <div className="space-y-0.5 text-xs">
                <p className="flex items-center gap-1.5 text-muted-foreground"><Scale className="h-3 w-3" /> {formatNumber(v.maxWeightKg, 0)} KG</p>
                <p className="flex items-center gap-1.5 text-muted-foreground"><Box className="h-3 w-3" /> {formatNumber(v.maxVolumeM3, 2)} M³</p>
                <p className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3 w-3" /> {v.maxKoli != null ? formatNumber(v.maxKoli, 0) : "—"} koli</p>
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
                  <p className="text-muted-foreground">
                    {formatNumber(v.activeLoad.totalActualWeightKg, 1)} KG · {formatNumber(v.activeLoad.totalVolumeM3, 2)} M³ · {formatNumber(v.activeLoad.totalKoli, 0)} koli
                  </p>
                ) : (
                  <p className="text-muted-foreground">tidak ada transport aktif</p>
                )}
              </div>
            ),
          },
          {
            key: "status",
            header: "Status Kapasitas",
            render: (v) =>
              v.activeCapacity ? (
                <div className="space-y-1">
                  <OverallCapacityBadge state={v.activeCapacity.overallStatus} />
                  <div className="flex gap-1">
                    {([["B", v.activeCapacity.weight.status], ["V", v.activeCapacity.volume.status], ["K", v.activeCapacity.koli.status]] as const).map(([lbl, st]) => (
                      <DimensionChip key={lbl} label={lbl} state={st} />
                    ))}
                  </div>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">idle</span>
              ),
          },
          {
            key: "actions",
            header: "Aksi",
            render: (v) => (
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setHistoryVehicle({ id: v.id, vehicleNumber: v.vehicleNumber })}
                  title="Riwayat perubahan kapasitas"
                >
                  <History className="h-3.5 w-3.5" /> Riwayat
                </Button>
                <Button asChild variant="ghost" size="sm" className="h-7">
                  <a href={`#/vehicles`}>Kelola</a>
                </Button>
              </div>
            ),
          },
        ]}
      />

      {/* Capacity Round — per-vehicle capacity-config change history (from audit). */}
      <VehicleCapacityHistoryDialog
        vehicleId={historyVehicle?.id ?? null}
        vehicleNumber={historyVehicle?.vehicleNumber ?? ""}
        open={historyVehicle != null}
        onOpenChange={(o) => !o && setHistoryVehicle(null)}
      />

      {/* Capacity Round — bulk-configure maxKoli confirmation (owner-only). */}
      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfigurasi Max Koli Otomatis?</AlertDialogTitle>
            <AlertDialogDescription>
              Ini akan mengisi <b>maxKoli</b> untuk <b>{summary?.unconfiguredVehicles ?? 0} kendaraan</b> yang belum dikonfigurasi,
              dengan saran otomatis berdasarkan kapasitas berat:
              <span className="mt-1.5 block rounded-md bg-muted/50 px-2 py-1 text-[11px] font-mono">
                ≤1500kg → 40 · ≤3000kg → 60 · ≤6000kg → 100 · lainnya → 150
              </span>
              Anda masih dapat mengubah nilai per-kendaraan di halaman Kendaraan. Tindakan ini dicatat di audit log.
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

function SummaryTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-0.5 text-xl font-bold tabular-nums", accent ?? "text-foreground")}>{value}</p>
        </div>
        <span className="text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );
}

/** Mini ring for the fleet list — 36px, shows max util % or "—" when idle. */
function CapacityRingMini({ row }: { row: FleetCapacityRow }) {
  if (!row.activeCapacity) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-[10px] text-muted-foreground">
        idle
      </div>
    );
  }
  return <CapacityRing capacity={row.activeCapacity} size={36} />;
}

function DimensionChip({ label, state }: { label: string; state: "OK" | "OVERLIMIT" | "UNCONFIGURED" }) {
  const cls = state === "OK" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
    : state === "OVERLIMIT" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return (
    <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold", cls)} title={label === "B" ? "Berat" : label === "V" ? "Volume" : "Koli"}>
      {label}
    </span>
  );
}
