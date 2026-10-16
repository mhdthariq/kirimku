"use client";

import { ArrowDownLeft, ArrowUpRight, Banknote, Briefcase, CarFront, CheckCircle2, Coins, Paperclip, Receipt, Wallet, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type FinanceSummary } from "@/infrastructure/http/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { StatusBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { DashboardHeading, DashboardMetric, DashboardSectionTitle, DashboardError } from "@/components/app/dashboard-ui";
import { OperationalExpensesPanel } from "@/components/app/operational-expense-report";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/utils";

const panel = "min-w-0 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6";

export function FinancePage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "financial.report.view");
  const { data, error, reload } = useApiData<FinanceSummary | null>(() => canView ? apiGet<FinanceSummary>("/finance/summary") : Promise.resolve(null), [canView]);
  const can = (permission: string) => hasPermission(user, permission);

  if (!canView) return <DashboardHeading eyebrow="Keuangan" title="Finance Dashboard" description="Anda tidak memiliki izin financial.report.view." />;
  if (error) return <DashboardError message={error} onRetry={() => { void reload(); }} />;
  if (!data) return <div aria-label="Memuat dashboard keuangan" className="space-y-6"><Skeleton className="h-20 w-full max-w-lg rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div></div>;

  const t = data.totals;
  const ip = data.invoicePayments;
  const pendingCommission = data.pending.commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
  const pendingCount = data.pending.topUps.length + data.pending.withdrawals.length + data.pending.commissions.length;
  const received = ip?.realized ?? t.realizedInvoicePayments;
  const settled = ip?.settledTotal ?? t.settledInvoicePayments;
  const partial = ip?.partialTotal ?? t.partialInvoicePayments;
  const receivedTotal = settled + partial;
  const settledPercent = receivedTotal > 0 ? (settled / receivedTotal) * 100 : 0;
  const link = (href: string, permission: string) => can(permission) ? href : undefined;

  return <div className="dashboard-workspace mx-auto min-w-0 max-w-[1600px] space-y-6 sm:space-y-8">
    <DashboardHeading eyebrow="Ringkasan keuangan" title="Finance Dashboard" description="Pantau penerimaan invoice, saldo partner, dan arus dana perusahaan." actions={<div className="flex flex-wrap gap-2"><span className="rounded-full border bg-card px-3 py-2 text-xs font-medium">{t.partnerCount} partner terdaftar</span><span className="rounded-full bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{pendingCount} menunggu proses</span></div>} />

    <section aria-label="Penerimaan invoice" className="relative overflow-hidden rounded-2xl bg-emerald-950 p-5 text-white sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border-[56px] border-emerald-400/10" />
      <div className="relative grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-end">
        <div className="min-w-0"><p className="flex items-center gap-2 text-xs font-medium text-emerald-200"><span className="rounded-lg bg-white/10 p-2"><Wallet className="h-4 w-4" /></span> Total penerimaan invoice</p><p className="mt-4 break-words text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-tight tracking-tight tabular-nums">{formatRupiah(received)}</p><p className="mt-3 max-w-lg text-xs leading-relaxed text-emerald-100/75">Akumulasi pembayaran lunas dan parsial yang telah diterima perusahaan.</p>{can("invoice.view") && <a className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/10 px-3 text-xs font-semibold transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white" href="#/invoices">Lihat invoice <ArrowUpRight className="h-4 w-4" /></a>}</div>
        <div className="grid min-w-0 gap-4 border-t border-white/15 pt-5 sm:grid-cols-2 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <div className="min-w-0"><p className="text-xs text-emerald-100/75">Invoice lunas</p><p className="mt-2 break-words text-lg font-semibold tabular-nums sm:text-xl">{formatRupiah(settled)}</p></div>
          <div className="min-w-0"><p className="text-xs text-emerald-100/75">Invoice parsial</p><p className="mt-2 break-words text-lg font-semibold tabular-nums sm:text-xl">{formatRupiah(partial)}</p></div>
          <div className="sm:col-span-2"><div className="flex h-2 overflow-hidden rounded-full bg-white/15" aria-hidden="true"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${settledPercent}%` }} /></div><p className="mt-2 text-[11px] text-emerald-100/75">{receivedTotal > 0 ? `${Math.round(settledPercent)}% penerimaan berasal dari invoice lunas` : "Belum ada pembayaran invoice tercatat"}</p></div>
        </div>
      </div>
    </section>

    <section className="space-y-4" aria-label="Ringkasan saldo dan distribusi">
      <DashboardSectionTitle title="Saldo & distribusi dana" description="Posisi wallet partner dan pembayaran yang sudah diproses." />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric label="Total Saldo Partner" value={formatRupiah(t.totalWalletBalance)} hint={`Tersedia ${formatRupiah(t.totalAvailable)} · Dicadangkan ${formatRupiah(t.totalReserved)}`} icon={<Wallet />} />
        <DashboardMetric label="Komisi B2B Dirilis" value={formatRupiah(t.releasedCommissions)} hint={`${data.pending.commissions.length} komisi masih menunggu pelunasan`} icon={<Coins />} tone="blue" />
        <DashboardMetric label="Profit Share Dibayar" value={formatRupiah(t.transportSharePaid)} hint={`Nilai transport ${formatRupiah(t.transportValueSettled)}`} icon={<CarFront />} tone="violet" />
        <DashboardMetric label="Withdrawal Selesai" value={formatRupiah(t.withdrawalsCompleted)} hint={`${data.pending.withdrawals.length} permintaan sedang diproses`} icon={<Banknote />} tone="amber" />
      </div>
    </section>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className={panel} aria-label="Arus top up dan withdrawal"><DashboardSectionTitle title="Pergerakan dana" description="Top up dan withdrawal dari ledger enam bulan terakhir." /><MoneyFlow rows={data.monthlyLedger} /></section>
      <section className={cn(panel, "flex flex-col")}><DashboardSectionTitle title="Perlu ditindaklanjuti" description="Antrean keuangan dan koreksi biaya operasional." /><dl className="mt-4 divide-y">
        <SummaryRow label="Komisi belum dirilis" value={formatRupiah(pendingCommission)} hint="Menunggu invoice lunas penuh" icon={<Briefcase className="h-4 w-4" />} />
        <SummaryRow label="Potongan repair" value={formatRupiah(t.repairDeductions)} hint="Total potongan perbaikan kendaraan" icon={<Wrench className="h-4 w-4" />} />
        <SummaryRow label="Transport belum disettle" value={String(t.unsettledArrivedTransports)} hint="Transport ARRIVED / COMPLETED" icon={<CarFront className="h-4 w-4" />} />
      </dl><p className="mt-auto rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">Komisi Marketing dirilis setelah invoice lunas penuh. Pembayaran parsial tetap tercatat sebagai penerimaan perusahaan.</p></section>
    </div>

    {ip && <section className={panel} aria-label="Pembayaran invoice terbaru"><DashboardSectionTitle title="Pembayaran Terbaru" description="Pembayaran invoice terakhir beserta status dan bukti penerimaan." action={can("invoice.view") && <a href="#/invoices" className="dashboard-text-link">Semua invoice <ArrowUpRight className="h-4 w-4" /></a>} />
      {ip.recent.length === 0 ? <EmptyState text="Belum ada pembayaran invoice." /> : <>
        <div className="mt-5 divide-y xl:hidden">{ip.recent.map(s => <div key={s.id} className="space-y-3 py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-2"><p className="break-all font-mono text-xs font-semibold">{s.invoiceNumber}</p><StatusBadge status={s.invoiceStatus} /></div><p className="break-words text-sm text-muted-foreground">{s.customerName}</p><div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-base font-semibold tabular-nums">{formatRupiah(s.amount)}</p><span className="text-xs text-muted-foreground">{formatDate(s.settledAt, true)}</span></div><ProofBadge hasProof={s.hasProof} /></div>)}</div>
        <div className="mt-5 hidden min-w-0 overflow-x-auto xl:block"><table className="w-full text-left text-sm"><thead><tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">{["Tanggal", "Invoice / Customer", "Jumlah", "Status", "Bukti"].map(label => <th key={label} className="px-3 pb-3 font-semibold first:pl-0">{label}</th>)}</tr></thead><tbody>{ip.recent.map(s => <tr key={s.id} className="border-b last:border-0"><td className="py-4 pr-3 text-xs text-muted-foreground">{formatDate(s.settledAt, true)}</td><td className="max-w-60 px-3 py-4"><p className="break-all font-mono text-xs font-semibold">{s.invoiceNumber}</p><p className="mt-1 break-words text-xs text-muted-foreground">{s.customerName}</p></td><td className="whitespace-nowrap px-3 py-4 font-semibold tabular-nums">{formatRupiah(s.amount)}</td><td className="px-3 py-4"><StatusBadge status={s.invoiceStatus} /></td><td className="px-3 py-4"><ProofBadge hasProof={s.hasProof} /></td></tr>)}</tbody></table></div>
      </>}
    </section>}

    <OperationalExpensesPanel />

    <section className="space-y-4" aria-label="Antrean keuangan"><DashboardSectionTitle title="Antrean & aktivitas" description="Tinjau pengajuan partner dan aktivitas operasional terbaru." /><div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <PendingSection title="Top Up Menunggu" icon={<Receipt className="h-4 w-4" />} href={link("#/topups", "wallet.topup.view")} items={data.pending.topUps.map(x => ({ id: x.id, left: `${x.partnerName} · ${x.requestCode}`, right: formatRupiah(x.amount), status: x.status, date: x.createdAt }))} />
      <PendingSection title="Withdrawal Menunggu" icon={<Banknote className="h-4 w-4" />} href={link("#/withdrawals", "wallet.withdrawal.view")} items={data.pending.withdrawals.map(x => ({ id: x.id, left: `${x.partnerName} · ${x.requestCode}`, right: formatRupiah(x.amount), status: x.status, date: x.createdAt }))} />
      <PendingSection title="Repair Terbaru" icon={<Wrench className="h-4 w-4" />} href={link("#/repairs", "repair.view")} empty="Belum ada riwayat repair." items={data.pending.repairs.map(x => ({ id: x.id, left: `${x.vehicleNumber} · ${x.ownerName}`, right: formatRupiah(x.amount), status: x.status, date: x.createdAt }))} />
      <PendingSection title="Komisi B2B PENDING" icon={<Briefcase className="h-4 w-4" />} href={link("#/settlements", "invoice.view")} items={data.pending.commissions.map(x => ({ id: x.id, left: `${x.partnerName} · ${x.invoiceNumber}`, right: formatRupiah(x.commissionAmount), status: "PENDING", date: x.createdAt }))} />
    </div></section>

    <section className={panel}><DashboardSectionTitle title="Partner & Wallet" description={`${t.marketingCount} Marketing · ${t.vehicleOwnerCount} Vehicle Owner`} action={can("partner.view") && <a href="#/partners" className="dashboard-text-link">Kelola partner <ArrowUpRight className="h-4 w-4" /></a>} />
      {data.partners.length === 0 ? <EmptyState text="Belum ada partner terdaftar." /> : <div className="mt-5 grid min-w-0 gap-3 xl:grid-cols-2">{data.partners.map(p => <div key={p.id} className="flex min-w-0 flex-col items-stretch justify-between gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><span className={cn("shrink-0 rounded-xl p-2.5", p.type === "MARKETING" ? "bg-emerald-500/10 text-primary" : "bg-violet-500/10 text-violet-600 dark:text-violet-400")}>{p.type === "MARKETING" ? <Briefcase className="h-4 w-4" /> : <CarFront className="h-4 w-4" />}</span><div className="min-w-0"><p className="break-words text-sm font-semibold">{p.name}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.type === "MARKETING" ? "Marketing" : `Vehicle Owner · ${p.vehicleCount} kendaraan`} · share {p.profitShare.partner}%</p></div></div><p className="max-w-full break-all text-sm font-semibold tabular-nums">{formatRupiah(p.walletBalance)}</p></div>)}</div>}
    </section>

    {data.monthlyLedger.length > 0 && <section className={panel}><DashboardSectionTitle title="Ledger 6 Bulan Terakhir" description="Rincian distribusi dana per kategori. Nilai ditampilkan sebagai nominal mutasi." />
      <div className="mt-5 grid gap-3 xl:hidden">{data.monthlyLedger.map(m => <div key={m.month} className="rounded-xl border p-4"><p className="mb-3 text-sm font-semibold">{monthLabel(m.month)}</p><dl className="grid gap-2 sm:grid-cols-2">{ledgerColumns.map(([type, label]) => <div key={type} className="flex min-w-0 flex-wrap items-center justify-between gap-1 text-xs"><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-semibold tabular-nums">{fmtSigned(m.byType[type])}</dd></div>)}</dl></div>)}</div>
      <div className="mt-5 hidden min-w-0 overflow-x-auto xl:block"><table className="w-full text-left text-xs"><thead><tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground"><th className="pb-3 font-semibold">Bulan</th>{ledgerColumns.map(([type, label]) => <th key={type} className="px-3 pb-3 text-right font-semibold">{label}</th>)}</tr></thead><tbody>{data.monthlyLedger.map(m => <tr key={m.month} className="border-b last:border-0"><td className="whitespace-nowrap py-4 font-medium">{monthLabel(m.month)}</td>{ledgerColumns.map(([type]) => <td key={type} className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{fmtSigned(m.byType[type])}</td>)}</tr>)}</tbody></table></div>
    </section>}
  </div>;
}

const ledgerColumns = [["TOPUP", "Top Up"], ["COMMISSION", "Komisi"], ["TRANSPORT_PROFIT_SHARE", "Profit Share"], ["REPAIR_DEDUCTION", "Repair"], ["WITHDRAWAL", "Withdrawal"]] as const;
function fmtSigned(value: number | undefined) { return value ? formatRupiah(Math.abs(value)) : "—"; }
function monthLabel(month: string) { const date = new Date(`${month}-01T00:00:00`); return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString("id-ID", { month: "short", year: "numeric" }); }
function EmptyState({ text }: { text: string }) { return <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />{text}</div>; }
function ProofBadge({ hasProof }: { hasProof: boolean }) { return hasProof ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"><Paperclip className="h-3 w-3" /> Bukti tersedia</span> : <span className="text-[11px] text-muted-foreground">Tanpa bukti</span>; }
function SummaryRow({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4">
    <dt className="flex min-w-0 items-start gap-3">
      <span className="shrink-0 rounded-lg bg-muted p-2 text-muted-foreground">{icon}</span>
      <span className="min-w-0"><span className="block text-xs font-medium">{label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span></span>
    </dt>
    <dd className="max-w-full break-all text-base font-semibold tabular-nums">{value}</dd>
  </div>;
}

function MoneyFlow({ rows }: { rows: FinanceSummary["monthlyLedger"] }) {
  const maximum = Math.max(1, ...rows.flatMap(m => [Math.abs(m.byType.TOPUP ?? 0), Math.abs(m.byType.WITHDRAWAL ?? 0)]));
  return <><div className="mt-5 flex flex-wrap gap-4 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><ArrowDownLeft className="h-3.5 w-3.5 text-primary" /> Top Up</span><span className="flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-sky-500" /> Withdrawal</span></div>{rows.length === 0 ? <EmptyState text="Belum ada mutasi dalam enam bulan terakhir." /> : <div className="mt-5 space-y-4">{rows.map(m => <div key={m.month} className="grid min-w-0 gap-2 sm:grid-cols-[70px_minmax(0,1fr)]"><p className="pt-1 text-xs font-medium text-muted-foreground">{monthLabel(m.month)}</p><div className="min-w-0 space-y-2">{(["TOPUP", "WITHDRAWAL"] as const).map(type => { const value = Math.abs(m.byType[type] ?? 0); return <div key={type} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,120px)] items-center gap-3 text-[11px]"><div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={cn("h-full rounded-full", type === "TOPUP" ? "bg-primary" : "bg-sky-500")} style={{ width: `${(value / maximum) * 100}%` }} /></div><p className="break-all text-right font-medium tabular-nums"><span className="sr-only">{type === "TOPUP" ? "Top Up" : "Withdrawal"}: </span>{formatRupiah(value)}</p></div>; })}</div></div>)}</div>}</>;
}
function PendingSection({ title, icon, href, items, empty = "Tidak ada pengajuan yang menunggu." }: { title: string; icon: ReactNode; href?: string; items: { id: number; left: string; right: string; status: string; date: string }[]; empty?: string }) {
  return <section className={panel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span className="shrink-0 rounded-lg bg-muted p-2 text-primary">{icon}</span>{title}<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{items.length}</span></h3>{href && <a href={href} className="dashboard-text-link">Kelola <ArrowUpRight className="h-3.5 w-3.5" /></a>}</div>{items.length === 0 ? <EmptyState text={empty} /> : <ul className="divide-y">{items.map(x => <li key={x.id} className="flex min-w-0 flex-col justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap"><div className="min-w-0 flex-1"><p className="break-words text-xs font-medium leading-relaxed">{x.left}</p><p className="mt-1 text-[11px] text-muted-foreground">{formatDate(x.date, true)}</p></div><div className="flex max-w-full flex-wrap items-center justify-between gap-2 sm:flex-col sm:items-end"><p className="break-all text-sm font-semibold tabular-nums">{x.right}</p><StatusBadge status={x.status} /></div></li>)}</ul>}</section>;
}
