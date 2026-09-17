"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  Bell,
  Boxes,
  ClipboardList,
  Coins,
  History,
  Landmark,
  Package,
  PackageSearch,
  Receipt,
  Route,
  Scale,
  Truck,
  Users,
  CarFront,
  Warehouse,
  Wallet,
  CheckCircle2,
  XCircle,
  Wrench,
  TrendingUp,
  ArrowDownCircle,
  ArrowUpCircle,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type DashboardData, type DashboardApprovalItem, type GudangDashboardWorkspace, type MarketingDashboardSnapshot } from "@/lib/client-api";
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

/** Approval card — one category of items waiting for the owner to act.
 *  Only rendered when the user actually has permission to act on the items. */
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
  const roleLabel: Record<typeof data.role, string> = {
    owner: "Owner",
    "admin-kantor": "Admin Kantor",
    marketing: "Marketing",
    "admin-gudang": "Admin Gudang",
    "staff-gudang": "Staff Gudang",
  };

  const approvals = data.approvals ?? {
    pendingTopups: [],
    pendingWithdrawals: [],
    pendingPayments: [],
    pendingCommissions: [],
  };

  // Each approval card is rendered ONLY when the user has the matching
  // permission. Marketing (and other roles without these permissions) thus
  // never see Top Up / Withdrawal / Payment Verify / Commission cards.
  const perms = data.permissions;
  const approvalCards: React.ReactNode[] = [];
  if (perms.canVerifyTopup) {
    approvalCards.push(
      <ApprovalCard
        key="topup"
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
      />,
    );
  }
  if (perms.canApproveWithdrawal) {
    approvalCards.push(
      <ApprovalCard
        key="withdrawal"
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
      />,
    );
  }
  if (perms.canVerifyPayment) {
    approvalCards.push(
      <ApprovalCard
        key="payment"
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
      />,
    );
  }
  if (perms.canReleaseCommission) {
    approvalCards.push(
      <ApprovalCard
        key="commission"
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
      />,
    );
  }
  const totalApprovals =
    (perms.canVerifyTopup ? approvals.pendingTopups.length : 0) +
    (perms.canApproveWithdrawal ? approvals.pendingWithdrawals.length : 0) +
    (perms.canVerifyPayment ? approvals.pendingPayments.length : 0) +
    (perms.canReleaseCommission ? approvals.pendingCommissions.length : 0);

  const stats = [
    { label: "Shipment Total", value: counts.shipments, icon: Package, href: "#/shipments", show: can("shipment.view") },
    { label: "Pickup Aktif", value: counts.activePickups, icon: Truck, href: "#/pickups", show: can("pickup.view") },
    { label: "Delivery Tertunda", value: counts.pendingDeliveries, icon: ClipboardList, href: "#/deliveries", show: can("delivery.view") },
    { label: "Transport Berjalan", value: counts.inTransit, icon: Route, href: "#/transports", show: can("transport.view") },
    { label: "Customer Aktif", value: counts.customers, icon: Users, href: "#/customers", show: can("customer.view") },
    { label: "Gudang", value: counts.gudang, icon: Warehouse, href: "#/gudang", show: can("warehouse.view") && user?.isOwner },
    { label: "Kendaraan", value: counts.vehicles, icon: CarFront, href: "#/vehicles", show: can("vehicle.view") },
    { label: "Invoice", value: counts.invoices, icon: Receipt, href: "#/invoices", show: can("invoice.view") },
  ].filter((s) => s.show && s.value != null);

  const maxStatus = Math.max(1, ...Object.values(data.statusCounts ?? {}));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title={`${greeting}, ${user?.name.split(" ")[0]}`}
          subtitle={`${roleLabel[data.role]} · Ringkasan operasional periode ${formatDate(from)} → ${formatDate(to)} (${data.period.days} hari).`}
        />
        <DatePeriodFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* 1. APPROVAL QUEUE — top priority (only if user has any approval permission) */}
      {approvalCards.length > 0 && (
        <>
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
                  Aktivitas yang perlu Anda tinjau &amp; setujui — Top Up, Withdrawal, Payment, dan Komisi Marketing yang siap dirilis.
                </p>
              </CardHeader>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {approvalCards}
          </div>
        </>
      )}

      {/* 2. Marketing partner snapshot — own wallet & commission pipeline */}
      {data.role === "marketing" && data.marketing && (
        <MarketingOverview snapshot={data.marketing} />
      )}

      {/* 3. Operational stat cards */}
      {stats.length > 0 && (
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
      )}

      {/* 4. Gudang workspace — Admin Gudang / Staff Gudang scan queue */}
      {data.gudang && (data.role === "admin-gudang" || data.role === "staff-gudang") && (
        <GudangScanQueue workspace={data.gudang} />
      )}

      {/* 5. Operational details (filtered by period) — owner / admin-kantor only */}
      {(data.role === "owner" || data.role === "admin-kantor") && (
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
      )}

      {/* 6. Recent shipments */}
      {can("shipment.view") && (data.role === "owner" || data.role === "admin-kantor" || data.role === "marketing") && (
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

// ---------------------------------------------------------------------------
// Marketing overview — own wallet, commission pipeline, recent activity
// ---------------------------------------------------------------------------

function MarketingOverview({ snapshot }: { snapshot: MarketingDashboardSnapshot }) {
  return (
    <div className="space-y-4">
      {/* Wallet + commission cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WalletStatCard
          label="Saldo Tersedia"
          value={formatRupiah(snapshot.wallet.available)}
          hint={`dari ${formatRupiah(snapshot.wallet.balance)} · reserved ${formatRupiah(snapshot.wallet.reserved)}`}
          icon={<Wallet className="h-4 w-4" />}
          accent="text-primary"
        />
        <WalletStatCard
          label="Komisi Dirilis"
          value={formatRupiah(snapshot.releasedCommission)}
          hint="total komisi B2B yang sudah masuk wallet"
          icon={<TrendingUp className="h-4 w-4" />}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <WalletStatCard
          label="Komisi PENDING"
          value={formatRupiah(snapshot.pendingCommission)}
          hint="menunggu invoice B2B LUNAS penuh"
          icon={<Coins className="h-4 w-4" />}
          accent="text-amber-600 dark:text-amber-400"
        />
        <WalletStatCard
          label="Withdrawal Aktif"
          value={formatRupiah(snapshot.pendingWithdrawals.reduce((s, w) => s + w.amount, 0))}
          hint={`${snapshot.pendingWithdrawals.length} permintaan sedang diproses`}
          icon={<Landmark className="h-4 w-4" />}
          accent="text-violet-600 dark:text-violet-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent commissions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" /> Komisi B2B Terbaru
              </span>
              <a href="#/b2b" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Buka B2B <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.recentCommissions.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Belum ada komisi B2B.
              </p>
            ) : (
              <ul className="space-y-2">
                {snapshot.recentCommissions.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-foreground">{c.commissionCode}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {c.customerName} · Invoice {c.invoiceNumber}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{formatRupiah(c.amount)}</span>
                      <StatusBadge status={c.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent wallet transactions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Transaksi Wallet Terakhir
              </span>
              <a href="#/wallet" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Buka Wallet <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.recentTransactions.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Belum ada transaksi wallet.
              </p>
            ) : (
              <ul className="space-y-2">
                {snapshot.recentTransactions.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("rounded-md p-1.5", t.direction === "CREDIT" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                        {t.direction === "CREDIT" ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{t.type}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{t.description ?? t.businessRef}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-bold", t.direction === "CREDIT" ? "text-primary" : "text-destructive")}>
                        {t.direction === "CREDIT" ? "+" : "−"}{formatRupiah(t.amount)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(t.createdAt, true)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WalletStatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={cn("mt-1 text-lg font-bold sm:text-xl", accent)}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gudang scan queue — Admin Gudang / Staff Gudang dashboard
// ---------------------------------------------------------------------------

function GudangScanQueue({ workspace }: { workspace: GudangDashboardWorkspace }) {
  const totalArrivals = workspace.arrivals.length + workspace.transportArrivals.length;
  const totalPackages = workspace.heldSummary.reduce((s, w) => s + w.heldPackages, 0);

  return (
    <div className="space-y-4">
      {/* Scope + summary */}
      <Card className="border-sky-300/60 bg-sky-50/40 dark:border-sky-900/60 dark:bg-sky-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              {workspace.scope.scoped
                ? `Gudang ${workspace.scope.warehouseName ?? "Anda"}`
                : "Semua Gudang"}
            </span>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                <Package className="h-3.5 w-3.5" /> {totalArrivals} shipment menunggu scan
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                <Boxes className="h-3.5 w-3.5" /> {formatNumber(totalPackages, 0)} paket di gudang
              </span>
            </div>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Daftar shipment yang perlu Anda scan & verifikasi — paket dari kurir (pickup selesai), paket dari gudang lain (transport tiba), serta walk-in dari customer.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pickup arrivals — kurir brought back packages */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Antrian Scan Pickup
              </span>
              <a href="#/shipments" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Buka Shipments <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
            <p className="text-xs text-muted-foreground">Paket dibawa kurir — scan setiap detail sebelum konfirmasi terima.</p>
          </CardHeader>
          <CardContent>
            {workspace.arrivals.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Tidak ada paket dari kurir yang menunggu scan.
              </p>
            ) : (
              <ul className="space-y-2">
                {workspace.arrivals.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#/shipments/${s.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 transition hover:border-primary/40 hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="font-mono text-xs">{s.masterCode}</span>
                          <span className="truncate">{s.customerName}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.origin} → {s.destination} · {s.scannedCount}/{s.detailsCount} paket
                          {s.kurirName ? ` · kurir ${s.kurirName}` : ""}
                          {s.pickupCode ? ` · ${s.pickupCode}` : ""}
                        </p>
                      </div>
                      <StatusBadge status="PICKED_UP" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Transport arrivals — from another gudang */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Route className="h-4 w-4 text-violet-600 dark:text-violet-400" /> Tiba dari Gudang Lain
              </span>
              <a href="#/shipments" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                Buka Shipments <ArrowRight className="h-3 w-3" />
              </a>
            </CardTitle>
            <p className="text-xs text-muted-foreground">Paket dari transport antar-gudang — scan dulu sebelum bisa delivery.</p>
          </CardHeader>
          <CardContent>
            {workspace.transportArrivals.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Tidak ada paket dari gudang lain yang menunggu scan.
              </p>
            ) : (
              <ul className="space-y-2">
                {workspace.transportArrivals.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#/shipments/${s.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 transition hover:border-primary/40 hover:bg-accent/50"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="font-mono text-xs">{s.masterCode}</span>
                          <span className="truncate">{s.customerName}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.originWarehouseName ? `dari ${s.originWarehouseName} · ` : ""}
                          {s.transportCode ?? "—"}
                          {s.driverName ? ` · driver ${s.driverName}` : ""}
                          {` · ${s.scannedCount}/${s.detailsCount} paket`}
                        </p>
                      </div>
                      <StatusBadge status="AT_DEST_GUDANG" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Walk-in + held summary */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Walk-In (Customer ke Gudang)
            </CardTitle>
            <p className="text-xs text-muted-foreground">Customer menyerahkan langsung — konfirmasi terima tanpa scan.</p>
          </CardHeader>
          <CardContent>
            {workspace.walkIns.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Tidak ada shipment walk-in.
              </p>
            ) : (
              <ul className="space-y-2">
                {workspace.walkIns.slice(0, 5).map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#/shipments/${s.id}`}
                      className="block rounded-lg border px-3 py-2 transition hover:border-primary/40 hover:bg-accent/50"
                    >
                      <p className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-foreground">{s.masterCode}</span>
                        <StatusBadge status={s.status} />
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {s.customerName} · {s.detailsCount} paket · {formatNumber(s.totalWeightKg, 1)} kg
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Warehouse className="h-4 w-4 text-primary" /> Isi Gudang Saya
            </CardTitle>
            <p className="text-xs text-muted-foreground">Ringkasan paket yang sedang tersimpan di gudang Anda.</p>
          </CardHeader>
          <CardContent>
            {workspace.heldSummary.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3.5 py-6 text-center text-xs text-muted-foreground">
                Belum ada data gudang.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {workspace.heldSummary.map((w) => (
                  <a
                    key={w.warehouseId}
                    href="#/gudang"
                    className="rounded-xl border bg-card p-3.5 transition hover:border-primary/40 hover:bg-accent/50"
                  >
                    <p className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{w.warehouseName}</span>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{w.city ?? "—"}</span>
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                      <div className="rounded-md bg-muted/60 px-1 py-1.5">
                        <p className="text-sm font-bold text-foreground">{w.heldShipments}</p>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Shipment</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-1 py-1.5">
                        <p className="text-sm font-bold text-foreground">{formatNumber(w.heldPackages, 0)}</p>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Paket</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-1 py-1.5">
                        <p className="text-sm font-bold text-foreground">{formatNumber(w.heldWeightKg, 0)}</p>
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">kg</p>
                      </div>
                    </div>
                    {w.unpaidCount > 0 && null}
                    {/* "belum lunas" badge dihapus — B2C ditanggung Marketing,
                        B2B via invoice. Dashboard tidak menampilkan status
                        pembayaran per shipment lagi. */}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
