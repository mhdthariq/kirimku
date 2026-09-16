"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  Bell,
  ClipboardList,
  Coins,
  History,
  Landmark,
  Package,
  Receipt,
  Route,
  Truck,
  Users,
  CarFront,
  Warehouse,
  Wallet,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type DashboardData, type DashboardApprovalItem } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader } from "@/components/app/data-table";
import { DatePeriodFilter } from "@/components/app/date-period-filter";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LIFECYCLE = ["CREATED", "READY_FOR_PICKUP", "PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "DELIVERED"];

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Approval card — one category of items waiting for the owner to act. */
function ApprovalCard({
  title,
  icon: Icon,
  items,
  href,
  accent,
  empty,
  renderItem,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: DashboardApprovalItem[];
  href: string;
  accent: string;
  empty: string;
  renderItem: (item: DashboardApprovalItem) => React.ReactNode;
}) {
  const count = items.length;
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <span className={cn("rounded-lg p-1.5", accent)}>
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </span>
          <span
            className={cn(
              "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold",
              count > 0 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {count === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.slice(0, 4).map((it) => (
              <li key={it.id}>{renderItem(it)}</li>
            ))}
          </ul>
        )}
        <a href={href} className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Buka menu <ArrowRight className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());

  const { data, loading } = useApiData<DashboardData>(
    () => apiGet<DashboardData>(`/dashboard?from=${from}&to=${to}`),
    [from, to],
  );

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const can = (p: string) => hasPermission(user, p);
  const counts = data.counts ?? {};
  const greeting = new Date().getHours() < 12 ? "Selamat pagi" : new Date().getHours() < 18 ? "Selamat siang" : "Selamat malam";

  const approvals = data.approvals ?? {
    pendingTopups: [],
    pendingWithdrawals: [],
    pendingPayments: [],
    pendingCommissions: [],
  };
  const totalApprovals =
    approvals.pendingTopups.length +
    approvals.pendingWithdrawals.length +
    approvals.pendingPayments.length +
    approvals.pendingCommissions.length;

  const stats = [
    { label: "Shipment Total", value: counts.shipments, icon: Package, href: "#/shipments", show: can("shipment.view") },
    { label: "Pickup Aktif", value: counts.activePickups, icon: Truck, href: "#/pickups", show: can("pickup.view") },
    { label: "Delivery Tertunda", value: counts.pendingDeliveries, icon: ClipboardList, href: "#/deliveries", show: can("delivery.view") },
    { label: "Transport Berjalan", value: counts.inTransit, icon: Route, href: "#/transports", show: can("transport.view") },
    { label: "Customer Aktif", value: counts.customers, icon: Users, href: "#/customers", show: can("customer.view") },
    { label: "Gudang", value: counts.gudang, icon: Warehouse, href: "#/gudang", show: can("warehouse.view") },
    { label: "Kendaraan", value: counts.vehicles, icon: CarFront, href: "#/vehicles", show: can("vehicle.view") },
    { label: "Invoice", value: counts.invoices, icon: Receipt, href: "#/invoices", show: can("invoice.view") },
  ].filter((s) => s.show && s.value != null);

  const maxStatus = Math.max(1, ...Object.values(data.statusCounts ?? {}));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={`${greeting}, ${user?.name.split(" ")[0]}`}
          subtitle={`Ringkasan operasional pengiriman periode ${formatDate(from)} → ${formatDate(to)} (${data.period.days} hari).`}
        />
        <DatePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* 1. APPROVAL QUEUE — top priority */}
      {totalApprovals > 0 && (
        <Card className="border-amber-300/60 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="relative inline-flex">
                <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                {totalApprovals > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                    {totalApprovals}
                  </span>
                )}
              </span>
              Perlu Approval Anda
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Aktivitas yang perlu Anda tinjau &amp; setujui terlebih dahulu — Top Up, Withdrawal, Payment, dan Komisi Marketing yang siap dirilis.
            </p>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ApprovalCard
          title="Top Up"
          icon={Wallet}
          items={approvals.pendingTopups}
          href="#/topups"
          accent="bg-sky-500/10 text-sky-600 dark:text-sky-400"
          empty="Tidak ada top up yang menunggu verifikasi."
          renderItem={(it) => (
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{it.requestCode}</span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(it.amount)}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {it.partnerName} · {formatDate(it.submittedAt ?? it.createdAt, true)}
              </p>
              {it.proofUrl && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Bukti transfer
                </span>
              )}
            </div>
          )}
        />
        <ApprovalCard
          title="Withdrawal"
          icon={Landmark}
          items={approvals.pendingWithdrawals}
          href="#/withdrawals"
          accent="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          empty="Tidak ada withdrawal yang menunggu review."
          renderItem={(it) => (
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{it.requestCode}</span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(it.amount)}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {it.partnerName} · {it.bankName} {it.bankAccountNumber}
              </p>
              <p className="text-[11px] text-muted-foreground">{formatDate(it.createdAt, true)}</p>
            </div>
          )}
        />
        <ApprovalCard
          title="Verifikasi Pembayaran"
          icon={Coins}
          items={approvals.pendingPayments}
          href="#/shipments"
          accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          empty="Tidak ada pembayaran yang menunggu verifikasi pada periode ini."
          renderItem={(it) => (
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{it.masterCode}</span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(it.amount)}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {it.customerName} · {it.method} · oleh {it.recordedByName}
              </p>
            </div>
          )}
        />
        <ApprovalCard
          title="Komisi Marketing"
          icon={Banknote}
          items={approvals.pendingCommissions}
          href="#/invoices"
          accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          empty="Tidak ada komisi yang menunggu (semua invoice B2B sudah LUNAS)."
          renderItem={(it) => (
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{it.commissionCode}</span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(it.amount)}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {it.partnerName} · Invoice {it.invoiceNumber} ({it.invoiceStatus})
              </p>
            </div>
          )}
        />
      </div>

      {/* 2. Operational stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <motion.a
            key={stat.label}
            href={stat.href}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex items-start justify-between p-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-foreground">{formatNumber(stat.value ?? 0, 0)}</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <stat.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </motion.a>
        ))}
      </div>

      {/* 3. Operational details (filtered by period) */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Shipment lifecycle funnel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Status Shipment
              <span className="ml-2 text-xs font-normal text-muted-foreground">Periode {formatDate(from)} → {formatDate(to)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 overflow-x-auto pb-2 sm:gap-3">
              {LIFECYCLE.map((status) => {
                const count = data.statusCounts?.[status] ?? 0;
                const height = Math.max(4, Math.round((count / maxStatus) * 96));
                return (
                  <a key={status} href="#/shipments" className="group flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground">{count}</span>
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-all group-hover:bg-primary"
                      style={{ height }}
                      aria-label={`${status}: ${count}`}
                    />
                    <StatusBadge status={status} className="scale-90" />
                  </a>
                );
              })}
            </div>
            {can("payment.view") && (
              <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/60 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Coins className="h-4 w-4 text-primary" /> Pembayaran terverifikasi (periode)
                </span>
                <span className="text-sm font-bold text-foreground">{formatRupiah(data.revenueVerified)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent audit */}
        {can("audit_log.view") && (
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-primary" /> Aktivitas Terbaru
                <span className="ml-1 text-xs font-normal text-muted-foreground">Periode</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2.5">
                {(data.recentAudit ?? []).slice(0, 6).map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{entry.entityLabel ?? entry.entityType}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {entry.action} · {entry.actorName}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(entry.createdAt, true)}</span>
                  </li>
                ))}
                {(data.recentAudit ?? []).length === 0 && (
                  <li className="px-2 py-6 text-center text-xs text-muted-foreground">Belum ada aktivitas pada periode ini.</li>
                )}
              </ul>
              <a href="#/audit" className="mt-4 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Lihat audit timeline <ArrowRight className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 4. Recent shipments */}
      {can("shipment.view") && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Shipment Terbaru
                <span className="ml-2 text-xs font-normal text-muted-foreground">Periode {formatDate(from)} → {formatDate(to)}</span>
              </CardTitle>
              <a href="#/shipments" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Semua shipment <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.recentShipments ?? []).map((s) => (
                <a
                  key={s.id}
                  href={`#/shipments/${s.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 transition hover:border-primary/40 hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-foreground">{s.masterCode}</span>
                    <span className="hidden text-sm text-muted-foreground sm:block">
                      {s.customerName} · {s.origin} → {s.destination}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-[11px] text-muted-foreground md:block">{formatDate(s.createdAt)}</span>
                    <StatusBadge status={s.status} />
                  </div>
                </a>
              ))}
              {(data.recentShipments ?? []).length === 0 && (
                <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-sm text-muted-foreground">
                  Belum ada shipment pada periode ini.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
