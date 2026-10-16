"use client";

import { useState } from "react";
import { ArrowUpRight, Receipt, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type OperationalExpenseRecord, type OperationalExpenseReport } from "@/infrastructure/http/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { EXPENSE_LABEL, EXPENSE_TYPES, isExpenseType } from "@/domain/transport-ops";
import { DashboardError, DashboardMetric, DashboardSectionTitle } from "@/components/app/dashboard-ui";
import { formatDate, formatRupiah, Input, FormSelect } from "@/components/app/form-parts";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";

export function ExpenseReportRows({ rows }: { rows: OperationalExpenseRecord[] }) {
  const { user } = useAuth();
  if (rows.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada biaya operasional yang cocok.</p>;
  return <ul className="divide-y rounded-xl border">{rows.map(row => <li key={row.id} className="flex min-w-0 flex-col justify-between gap-3 p-4 sm:flex-row sm:flex-wrap">
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{isExpenseType(row.type) ? EXPENSE_LABEL[row.type] : row.type}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.expenseCode}</p>{hasPermission(user, "transport.view") ? <a href={`/#/transports/${row.transport.id}?tab=expenses`} className="mt-2 inline-flex min-h-9 items-center gap-1 break-all text-xs font-semibold text-primary">{row.transport.transportCode}<ArrowUpRight className="h-3.5 w-3.5 shrink-0" /></a> : <p className="mt-2 break-all text-xs">{row.transport.transportCode}</p>}<p className="break-words text-xs text-muted-foreground">{row.transport.origin ?? "—"} → {row.transport.destination ?? "—"}</p>{row.description && <p className="mt-2 break-words text-xs leading-relaxed">{row.description}</p>}</div>
    <div className="flex max-w-full flex-wrap items-center justify-between gap-2 sm:flex-col sm:items-end"><p className="break-all text-base font-semibold tabular-nums">{formatRupiah(row.amount)}</p><StatusBadge status={row.status} /><p className="text-xs text-muted-foreground">{formatDate(row.createdAt, true)}</p></div>
  </li>)}</ul>;
}

export function OperationalExpensesPanel({ register = false }: { register?: boolean }) {
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), ...(type !== "all" ? { type } : {}), ...(status !== "all" ? { status } : {}), ...(query ? { search: query } : {}) });
  const { data, loading, error, reload } = useApiData<OperationalExpenseReport>(() => apiGet(`/finance/operational-expenses?${params}`), [page, type, status, query]);
  if (error) return <DashboardError message={error} onRetry={() => { void reload(); }} />;
  if (!data || !Array.isArray(data.byType)) return <p role="status" className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Memuat biaya operasional…</p>;
  return <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-6" aria-label="Laporan biaya operasional">
    <DashboardSectionTitle title="Biaya Operasional" description="Biaya transport seluruh periode. Setiap transaksi dihitung sekali, termasuk transport dengan beberapa shipment." action={!register && <a href="/#/operational-expenses" className="dashboard-text-link">Semua biaya <ArrowUpRight className="h-4 w-4" /></a>} />
    <div className="grid gap-3 sm:grid-cols-2"><DashboardMetric label="Total biaya disetujui" value={formatRupiah(data.approvedTotal)} hint="Biaya operasional APPROVED" icon={<Wallet />} /><DashboardMetric label="Menunggu persetujuan" value={formatRupiah(data.pendingTotal)} hint="Belum dihitung dalam total biaya disetujui" icon={<Receipt />} tone="amber" /></div>
    <div className="grid min-w-0 gap-2 min-[400px]:grid-cols-2 xl:grid-cols-5">{data.byType.map(row => <div key={row.type} className="min-w-0 rounded-xl border bg-muted/20 p-3"><h3 className="text-xs text-muted-foreground">{row.label}</h3><p className="mt-2 break-all text-sm font-semibold tabular-nums">{formatRupiah(row.approved)}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.count} transaksi</p>{row.pending > 0 && <p className="mt-1 break-words text-[11px] text-amber-700 dark:text-amber-300">Pending {formatRupiah(row.pending)}</p>}</div>)}</div>
    {register && <form className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><Input aria-label="Cari biaya atau transport" maxLength={150} value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari kode biaya / transport…" /><FormSelect ariaLabel="Filter jenis biaya" value={type} onValueChange={value => { setType(value); setPage(1); }} options={[{ value: "all", label: "Semua jenis" }, ...EXPENSE_TYPES.map(value => ({ value, label: EXPENSE_LABEL[value] }))]} /><FormSelect ariaLabel="Filter status biaya" value={status} onValueChange={value => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Semua status" }, { value: "APPROVED", label: "Approved" }, { value: "PENDING", label: "Pending" }]} /><Button type="submit" variant="outline" disabled={loading}>Cari</Button></form>}
    <ExpenseReportRows rows={register ? data.rows : data.rows.slice(0, 6)} />
    {register && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{data.count} transaksi · Halaman {data.page} dari {data.pages}</p><div className="flex gap-2"><Button variant="outline" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><Button variant="outline" disabled={loading || page >= data.pages} onClick={() => setPage(page + 1)}>Berikutnya</Button></div></div>}
  </section>;
}

export function ShipmentTransportExpenses({ shipmentId }: { shipmentId: number }) {
  const { data, error, reload } = useApiData<{ rows: OperationalExpenseRecord[]; approvedTotal: number; pendingTotal: number }>(() => apiGet(`/shipments/${shipmentId}/operational-expenses`), [shipmentId]);
  if (error) return <DashboardError message={error} onRetry={() => { void reload(); }} />;
  return <section className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-6" aria-label="Biaya transport terkait shipment"><DashboardSectionTitle title="Biaya Transport Terkait" description="Biaya bersama untuk seluruh muatan transport, bukan biaya khusus shipment ini. Finance menghitung setiap biaya sekali." />
    {!data ? <p role="status" className="text-sm text-muted-foreground">Memuat biaya transport…</p> : <><dl className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="rounded-xl bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">Biaya bersama disetujui</dt><dd className="mt-1 break-all text-lg font-semibold">{formatRupiah(data.approvedTotal)}</dd></div><div className="rounded-xl bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">Biaya bersama pending</dt><dd className="mt-1 break-all text-lg font-semibold">{formatRupiah(data.pendingTotal)}</dd></div></dl><ExpenseReportRows rows={data.rows} /></>}
  </section>;
}
