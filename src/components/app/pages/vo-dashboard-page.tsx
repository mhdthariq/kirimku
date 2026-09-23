"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  CarFront,
  CheckCircle2,
  CircleDot,
  Package,
  TrendingUp,
  Wrench,
  Wallet as WalletIcon,
  AlertTriangle,
  History,
  Banknote,
} from "lucide-react";
import { apiGet, type VehicleOwnerDashboard } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { TX_LABELS } from "@/components/app/pages/wallet-page";
import { formatRupiah, formatDate, formatNumber } from "@/components/app/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const VEHICLE_STATUS_META: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Aktif", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  MAINTENANCE: { label: "Maintenance", tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  INACTIVE: { label: "Nonaktif", tone: "bg-muted text-muted-foreground" },
};

/**
 * Vehicle Owner dashboard (Revise.md §17) — enhanced:
 *   1. Wallet / earnings / repair / withdrawal summary (top stat cards)
 *   2. Per-vehicle status cards — every vehicle with its status, capacity,
 *      recent repair activity
 *   3. Full list of repairs (not just the action log) so the VO can audit
 *      every deduction that hit their wallet
 *   4. Commission / earnings breakdown — settlements, pending withdrawals,
 *      recent transactions
 */
export function VehicleOwnerDashboard() {
  const { data, loading } = useApiData<VehicleOwnerDashboard>(() => apiGet<VehicleOwnerDashboard>("/partner/dashboard"), []);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard Vehicle Owner" subtitle="Memuat data…" icon={<CarFront className="h-5 w-5" />} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      </div>
    );
  }

  const activeVehicles = data.vehicleStatusBreakdown?.ACTIVE ?? 0;
  const maintenanceVehicles = data.vehicleStatusBreakdown?.MAINTENANCE ?? 0;
  const inactiveVehicles = data.vehicleStatusBreakdown?.INACTIVE ?? 0;

  const stats = [
    {
      label: "Saldo Tersedia",
      value: formatRupiah(data.wallet.available),
      icon: <CheckCircle2 className="h-4 w-4" />,
      accent: "text-primary",
      sub: `dari ${formatRupiah(data.wallet.balance)} (reserved ${formatRupiah(data.wallet.reserved)})`,
    },
    {
      label: "Total Komisi/Earnings",
      value: formatRupiah(data.totals.earnings),
      icon: <TrendingUp className="h-4 w-4" />,
      accent: "text-emerald-600 dark:text-emerald-400",
      sub: `dari ${data.totals.transportCount} transport disettle`,
    },
    {
      label: "Repair Deductions",
      value: formatRupiah(data.totals.repairDeductions),
      icon: <Wrench className="h-4 w-4" />,
      accent: "text-destructive",
      sub: `${data.repairs.length} repair terverifikasi & terdeduct`,
    },
    {
      label: "Withdrawal Aktif",
      value: formatRupiah(data.totals.pendingWithdrawals),
      icon: <WalletIcon className="h-4 w-4" />,
      accent: "text-violet-600 dark:text-violet-400",
      sub: `sedang diproses · ${formatRupiah(data.totals.withdrawals)} sudah selesai`,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard Vehicle Owner"
        subtitle="Armada, earnings, repair, dan wallet Anda - hanya milik Anda (§39)."
        icon={<CarFront className="h-5 w-5" />}
        actions={
          data.recentRepairLogs.length > 0 ? (
            <a href="#/repairs">
              <span className="inline-flex items-center gap-2 rounded-xl border border-chart-4/40 bg-chart-4/10 px-4 py-2 text-xs font-semibold text-chart-4">
                <Wrench className="h-3.5 w-3.5" /> {data.recentRepairLogs.length} aktivitas repair terbaru
              </span>
            </a>
          ) : undefined
        }
      />

      {/* 1. Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <span className="text-muted-foreground">{s.icon}</span>
            </div>
            <p className={cn("mt-1 text-lg font-bold sm:text-xl", s.accent)}>{s.value}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* 2. Per-vehicle status cards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CarFront className="h-4 w-4 text-primary" /> Status Kendaraan Saya
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <CircleDot className="h-3 w-3" /> {activeVehicles} Aktif
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <Wrench className="h-3 w-3" /> {maintenanceVehicles} Maintenance
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {inactiveVehicles} Nonaktif
            </span>
          </div>
        </div>

        {data.vehicles.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Belum ada kendaraan terdaftar. Hubungi admin untuk menambahkan kendaraan milik Anda.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.vehicles.map((v) => {
              const meta = VEHICLE_STATUS_META[v.status] ?? { label: v.status, tone: "bg-muted text-muted-foreground" };
              // count repairs tied to THIS vehicle so the card surfaces how
              // many deduction entries have hit the wallet for this truck
              const vehicleRepairs = data.repairs.filter((r) => r.vehicleId === v.id);
              const vehicleRepairTotal = vehicleRepairs.reduce((sum, r) => sum + r.amount, 0);
              return (
                <Card key={v.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="flex min-w-0 items-center gap-2">
                        <CarFront className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate font-mono text-sm font-bold">{v.vehicleNumber}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", meta.tone)}>
                        {meta.label}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {v.name ?? "-"} · kapasitas {formatNumber(v.maxWeightKg, 0)} kg / {formatNumber(v.maxVolumeM3, 2)} m³
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                        <p className="text-sm font-bold text-foreground">{vehicleRepairs.length}</p>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Repair</p>
                      </div>
                      <div className="rounded-lg bg-muted/60 px-2 py-1.5">
                        <p className="text-sm font-bold text-destructive">{formatRupiah(vehicleRepairTotal)}</p>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Deduct</p>
                      </div>
                    </div>
                    <a
                      href="#/my-vehicles"
                      className="flex items-center justify-center gap-1 pt-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      Lihat detail kendaraan →
                    </a>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Recent settlements + Recent repair activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent settlements - commission money */}
        <section className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Komisi Transport Terakhir
            </p>
            <a href="#/vo-transport-history" className="text-xs text-primary hover:underline">Riwayat lengkap →</a>
          </div>
          <div className="divide-y">
            {data.recentSettlements.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada settlement transport.</p>
            )}
            {data.recentSettlements.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">
                    {s.transport.transportCode} <span className="text-xs font-normal text-muted-foreground">· {s.vehicle.vehicleNumber}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.transport.origin ?? "?"} → {s.transport.destination ?? "?"} · nilai {formatRupiah(s.transportValue)}
                  </p>
                </div>
                <div className="text-right">
                  {/* settled earnings → GREEN */}
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{formatRupiah(s.ownerAmount)}</p>
                  <p className="text-[10px] text-muted-foreground">{s.ownerPercent}% · {formatDate(s.finalizedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Recent repair activity (action log) - the VO no longer approves
            anything; this feed keeps them informed of create/update/delete. */}
        <section className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Aktivitas Repair Terbaru</p>
            <a href="#/repairs" className="text-xs text-primary hover:underline">Log lengkap →</a>
          </div>
          <div className="divide-y">
            {data.recentRepairLogs.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada aktivitas repair.</p>
            )}
            {data.recentRepairLogs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">
                    <span
                      className={cn(
                        "mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        log.action === "CREATED"
                          ? "bg-primary/10 text-primary"
                          : log.action === "DELETED"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-chart-3/15 text-chart-3",
                      )}
                    >
                      {log.action === "CREATED" ? "Dibuat" : log.action === "DELETED" ? "Dihapus" : "Diubah"}
                    </span>
                    <span className="font-mono text-xs font-semibold">{log.repairCode}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{log.detail}</p>
                </div>
                <p className="shrink-0 text-[10px] text-muted-foreground">{formatDate(log.createdAt, true)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 4. Full list of repairs - every deduction that hit the wallet */}
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Wrench className="h-4 w-4 text-chart-4" /> Daftar Repair Saya
          </p>
          <span className="text-[11px] text-muted-foreground">
            {data.repairs.length} repair · total {formatRupiah(data.totals.repairDeductions)} terdeduct
          </span>
        </div>
        {data.repairs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Belum ada repair. Setiap kali perusahaan mencatat biaya repair untuk kendaraan Anda, akan muncul di sini.
          </p>
        ) : (
          <div className="divide-y">
            {data.repairs.slice(0, 10).map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="font-mono text-xs">{r.repairCode}</span>
                    <span className="text-xs text-muted-foreground">· {r.vehicle.vehicleNumber}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.description}
                    {r.workshopVendor ? ` · bengkel ${r.workshopVendor}` : ""}
                    {` · ${formatDate(r.repairDate)}`}
                  </p>
                  {r.notes && <p className="mt-0.5 text-[11px] text-muted-foreground">Catatan: {r.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-destructive">−{formatRupiah(r.amount)}</p>
                  <p className="text-[10px] text-muted-foreground">deduct {formatDate(r.verifiedAt, true)}</p>
                </div>
              </div>
            ))}
            {data.repairs.length > 10 && (
              <a href="#/repairs" className="flex items-center justify-center gap-1 py-2 text-xs font-semibold text-primary hover:underline">
                Lihat semua {data.repairs.length} repair →
              </a>
            )}
          </div>
        )}
      </section>

      {/* 5. Recent wallet transactions */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-primary" /> Transaksi Wallet Terakhir
          </p>
          <a href="#/wallet" className="text-xs text-primary hover:underline">Wallet →</a>
        </div>
        <div className="divide-y">
          {data.recentTransactions.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada transaksi.</p>
          )}
          {data.recentTransactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={cn("rounded-md p-1.5", t.direction === "CREDIT" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                  {t.direction === "CREDIT" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{TX_LABELS[t.type] ?? t.type}</p>
                  <p className="text-xs text-muted-foreground">{t.description ?? t.businessRef}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={cn("text-sm font-bold", t.direction === "CREDIT" ? "text-primary" : "text-destructive")}>
                  {t.direction === "CREDIT" ? "+" : "−"}{formatRupiah(t.amount)}
                </p>
                <p className="text-[10px] text-muted-foreground">{formatDate(t.createdAt, true)} · saldo {formatRupiah(t.balanceAfter)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
