"use client";

import {
  ArrowDownCircle,
  Banknote,
  Briefcase,
  CarFront,
  Coins,
  LayoutDashboard,
  Receipt,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type FinanceSummary } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

/**
 * Finance Dashboard (Revise.md §33/§34) — Admin Kantor / Owner Company:
 * aggregate wallet totals, pending workflows, partner overview, monthly ledger.
 */
export function FinancePage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "financial.report.view");
  const { data, loading } = useApiData<FinanceSummary>(() => apiGet<FinanceSummary>("/finance/summary"), []);

  if (!canView) {
    return <PageHeader title="Finance Dashboard" subtitle="Anda tidak memiliki izin financial.report.view." icon={<LayoutDashboard className="h-5 w-5" />} />;
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Finance Dashboard" subtitle="Memuat…" icon={<LayoutDashboard className="h-5 w-5" />} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />)}</div>
      </div>
    );
  }

  const t = data.totals;
  const stats = [
    { label: "Total Saldo Partner", value: formatRupiah(t.totalWalletBalance), sub: `tersedia ${formatRupiah(t.totalAvailable)} · reserved ${formatRupiah(t.totalReserved)}`, icon: <Coins className="h-4 w-4" /> },
    { label: "Komisi B2B Dirilis", value: formatRupiah(t.releasedCommissions), sub: `${data.pending.commissions.length} masih PENDING`, icon: <TrendingUp className="h-4 w-4" /> },
    { label: "Profit Share Dibayar", value: formatRupiah(t.transportSharePaid), sub: `nilai transport ${formatRupiah(t.transportValueSettled)}`, icon: <CarFront className="h-4 w-4" /> },
    { label: "Withdrawal Selesai", value: formatRupiah(t.withdrawalsCompleted), sub: `${data.pending.withdrawals.length} in-flight`, icon: <Banknote className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance Dashboard"
        subtitle={`${t.partnerCount} partner (${t.marketingCount} Marketing · ${t.vehicleOwnerCount} Vehicle Owner) · ${t.unsettledArrivedTransports} transport ARRIVED belum disettle`}
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">Total repair deductions</p>
            <p className="text-base font-bold text-destructive">{formatRupiah(t.repairDeductions)}</p>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <span className="text-muted-foreground">{s.icon}</span>
            </div>
            <p className="mt-1 text-lg font-bold sm:text-xl">{s.value}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Pending queues */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PendingSection
          title="Top Up Menunggu"
          icon={<Receipt className="h-4 w-4" />}
          href="#/topups"
          items={data.pending.topUps.map((x) => ({
            id: x.id,
            left: `${x.partnerName} · ${x.requestCode}`,
            right: formatRupiah(x.amount),
            status: x.status,
            date: x.createdAt,
          }))}
        />
        <PendingSection
          title="Withdrawal Menunggu"
          icon={<Banknote className="h-4 w-4" />}
          href="#/withdrawals"
          items={data.pending.withdrawals.map((x) => ({
            id: x.id,
            left: `${x.partnerName} · ${x.requestCode}`,
            right: formatRupiah(x.amount),
            status: x.status,
            date: x.createdAt,
          }))}
        />
        <PendingSection
          title="Repair Menunggu Konfirmasi"
          icon={<Wrench className="h-4 w-4" />}
          href="#/repairs"
          items={data.pending.repairs.map((x) => ({
            id: x.id,
            left: `${x.vehicleNumber} · ${x.ownerName}`,
            right: formatRupiah(x.amount),
            status: x.status,
            date: x.createdAt,
          }))}
        />
        <PendingSection
          title="Komisi B2B PENDING"
          icon={<Briefcase className="h-4 w-4" />}
          href="#/settlements"
          items={data.pending.commissions.map((x) => ({
            id: x.id,
            left: `${x.partnerName} · ${x.invoiceNumber}`,
            right: formatRupiah(x.commissionAmount),
            status: "PENDING",
            date: x.createdAt,
          }))}
        />
      </div>

      {/* Partner wallets overview */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Partner & Wallet</p>
          <a href="#/partners" className="text-xs text-primary hover:underline">Kelola profit sharing →</a>
        </div>
        <div className="divide-y">
          {data.partners.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className={cn("rounded-md p-1.5", p.type === "MARKETING" ? "bg-primary/10 text-primary" : "bg-chart-5/10 text-chart-5")}>
                  {p.type === "MARKETING" ? <Briefcase className="h-4 w-4" /> : <CarFront className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.type === "MARKETING" ? "Marketing" : `Vehicle Owner · ${p.vehicleCount} kendaraan`} · share {p.profitShare.partner}%
                  </p>
                </div>
              </div>
              <p className="text-sm font-bold">{formatRupiah(p.walletBalance)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Monthly ledger */}
      {data.monthlyLedger.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ArrowDownCircle className="h-4 w-4" /> Ledger 6 Bulan Terakhir
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-4 font-medium">Bulan</th>
                  <th className="py-1.5 pr-4 font-medium">Top Up</th>
                  <th className="py-1.5 pr-4 font-medium">Komisi</th>
                  <th className="py-1.5 pr-4 font-medium">Profit Share</th>
                  <th className="py-1.5 pr-4 font-medium">Repair</th>
                  <th className="py-1.5 font-medium">Withdrawal</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyLedger.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs font-semibold">{m.month}</td>
                    <td className="py-2 text-xs">{fmtSigned(m.byType.TOPUP)}</td>
                    <td className="py-2 text-xs">{fmtSigned(m.byType.COMMISSION)}</td>
                    <td className="py-2 text-xs">{fmtSigned(m.byType.TRANSPORT_PROFIT_SHARE)}</td>
                    <td className="py-2 text-xs text-destructive">{fmtSigned(m.byType.REPAIR_DEDUCTION)}</td>
                    <td className="py-2 text-xs text-destructive">{fmtSigned(m.byType.WITHDRAWAL)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function fmtSigned(v: number | undefined): string {
  if (v == null || v === 0) return "—";
  return formatRupiah(Math.abs(v));
}

function PendingSection({
  title,
  icon,
  href,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  items: { id: number; left: string; right: string; status: string; date: string }[];
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</p>
        <a href={href} className="text-xs text-primary hover:underline">Kelola →</a>
      </div>
      <div className="divide-y">
        {items.length === 0 && <p className="px-4 py-5 text-center text-xs text-muted-foreground">Tidak ada antrean 🎉</p>}
        {items.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{x.left}</p>
              <p className="text-[10px] text-muted-foreground">{formatDate(x.date, true)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={x.status} />
              <span className="text-xs font-semibold">{x.right}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
