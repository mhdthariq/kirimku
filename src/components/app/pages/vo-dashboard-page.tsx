"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  CarFront,
  CheckCircle2,
  Package,
  ShieldQuestion,
  TrendingUp,
  Wrench,
  Wallet as WalletIcon,
} from "lucide-react";
import { apiGet, type VehicleOwnerDashboard } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { TX_LABELS } from "@/components/app/pages/wallet-page";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

/**
 * Vehicle Owner dashboard (Revise.md §17): Available Balance, Total Earnings,
 * Total Transport Count, Total Repair Deductions, Total Withdrawals,
 * My Vehicles, Recent Transport, Recent Wallet Transactions.
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

  const stats = [
    { label: "Saldo Tersedia", value: formatRupiah(data.wallet.available), icon: <CheckCircle2 className="h-4 w-4" />, accent: "text-primary", sub: `dari ${formatRupiah(data.wallet.balance)} (reserved ${formatRupiah(data.wallet.reserved)})` },
    { label: "Total Earnings", value: formatRupiah(data.totals.earnings), icon: <TrendingUp className="h-4 w-4" />, accent: "text-foreground", sub: "profit share transport" },
    { label: "Total Transport", value: `${data.totals.transportCount}×`, icon: <Package className="h-4 w-4" />, accent: "text-foreground", sub: "transport disettle" },
    { label: "Repair Deductions", value: formatRupiah(data.totals.repairDeductions), icon: <Wrench className="h-4 w-4" />, accent: "text-destructive", sub: "terkonfirmasi dua pihak" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard Vehicle Owner"
        subtitle="Armada, earnings, repair, dan wallet Anda — hanya milik Anda (§39)."
        icon={<CarFront className="h-5 w-5" />}
        actions={
          data.pendingRepairs > 0 ? (
            <a href="#/repairs">
              <span className="inline-flex items-center gap-2 rounded-xl border border-chart-4/40 bg-chart-4/10 px-4 py-2 text-xs font-semibold text-chart-4">
                <Wrench className="h-3.5 w-3.5" /> {data.pendingRepairs} repair menunggu konfirmasi Anda
              </span>
            </a>
          ) : undefined
        }
      />

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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* My vehicles */}
        <section className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Kendaraan Saya</p>
            <a href="#/my-vehicles" className="text-xs text-primary hover:underline">Lihat semua →</a>
          </div>
          <div className="divide-y">
            {data.vehicles.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada kendaraan terdaftar.</p>}
            {data.vehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{v.vehicleNumber}</p>
                  <p className="text-xs text-muted-foreground">{v.name} · kapasitas {v.maxWeightKg} kg / {v.maxVolumeM3} m³</p>
                </div>
                <StatusBadge status={v.status} />
              </div>
            ))}
          </div>
        </section>

        {/* Recent settlements */}
        <section className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Transport Terakhir</p>
            <a href="#/vo-transport-history" className="text-xs text-primary hover:underline">Riwayat lengkap →</a>
          </div>
          <div className="divide-y">
            {data.recentSettlements.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada settlement transport.</p>}
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
                  <p className="text-sm font-bold text-primary">+{formatRupiah(s.ownerAmount)}</p>
                  <p className="text-[10px] text-muted-foreground">{s.ownerPercent}% · {formatDate(s.finalizedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Recent wallet transactions */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Transaksi Wallet Terakhir</p>
          <a href="#/wallet" className="text-xs text-primary hover:underline">Wallet →</a>
        </div>
        <div className="divide-y">
          {data.recentTransactions.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Belum ada transaksi.</p>}
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
