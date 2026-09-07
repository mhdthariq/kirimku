"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Download, History, Search } from "lucide-react";
import { apiGetWithMeta, type AuditResponse, type AuditEntry } from "@/lib/client-api";
import { useAuth } from "@/hooks/use-auth";
import { hasPermission } from "@/lib/client-api";
import { PageHeader } from "@/components/app/data-table";
import { formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ENTITY_LABELS: Record<string, string> = {
  auth: "Auth",
  customer: "Customer",
  shipment: "Shipment",
  shipment_detail: "Detail Shipment",
  pickup: "Pickup",
  delivery: "Delivery",
  transport: "Transport",
  vehicle: "Kendaraan",
  warehouse: "Gudang",
  route: "Rute",
  checkpoint: "Checkpoint",
  tariff: "Tarif",
  payment: "Pembayaran",
  invoice: "Invoice",
  invoice_line: "Baris Invoice",
  user: "User",
  role: "Role",
  employee: "Employee",
};

const ACTION_STYLES: Record<string, string> = {
  created: "bg-primary/10 text-primary",
  updated: "bg-chart-4/15 text-chart-4",
  deleted: "bg-destructive/10 text-destructive",
  deactivated: "bg-destructive/10 text-destructive",
  disabled: "bg-destructive/10 text-destructive",
  login: "bg-muted text-muted-foreground",
  logout: "bg-muted text-muted-foreground",
  priced: "bg-chart-2/15 text-chart-2",
  settled: "bg-primary/10 text-primary",
  status_change: "bg-chart-3/15 text-chart-3",
  cancelled: "bg-destructive/10 text-destructive",
};

const PAGE_SIZE = 30;

export function AuditPage() {
  const { user } = useAuth();
  const canView = hasPermission(user, "audit_log.view");

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (entityFilter !== "all") params.set("entityType", entityFilter);
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await apiGetWithMeta<AuditResponse["data"]>(`/audit-logs?${params}`);
      setEntries(res.data ?? []);
      setEntityTypes((res.meta?.entityTypes as string[] | undefined) ?? []);
      setActions((res.meta?.actions as string[] | undefined) ?? []);
      setTotal(typeof res.meta?.total === "number" ? res.meta.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat audit log.");
    } finally {
      setLoading(false);
    }
  }, [entityFilter, actionFilter, search, offset]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (!canView) {
    return <PageHeader title="Audit Timeline" subtitle="Anda tidak memiliki izin melihat audit log." />;
  }

  function exportCsv() {
    const header = ["id", "waktu", "aksi", "entitas", "label", "aktor"];
    const lines = entries.map((e) =>
      [e.id, new Date(e.createdAt).toISOString(), e.action, e.entityType, `"${(e.entityLabel ?? "").replace(/"/g, '""')}"`, e.actorName].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Timeline"
        subtitle="Jejak audit seluruh sistem — setiap menu juga punya log aktivitasnya sendiri."
        icon={<History className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={entries.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} placeholder="Cari label / aktor / aksi…" className="pl-9" />
        </div>
        <select
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setOffset(0); }}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          aria-label="Filter entitas"
        >
          <option value="all">Semua entitas</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          aria-label="Filter aksi"
        >
          <option value="all">Semua aksi</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive">{error}</p>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Tidak ada entri audit yang cocok dengan filter.
        </p>
      ) : (
        <>
          <ol className="relative ml-2 space-y-0 border-l pl-5">
            {entries.map((entry) => (
              <li key={entry.id} className="relative pb-5 pt-1">
                <span className="absolute -left-[23px] top-2 flex h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                <div className="rounded-xl border bg-card p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", ACTION_STYLES[entry.action] ?? "bg-muted text-muted-foreground")}>
                      {entry.action}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</Badge>
                    <span className="text-sm font-semibold text-foreground">{entry.entityLabel ?? `#${entry.entityId ?? "?"}`}</span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatDate(entry.createdAt, true)}
                    </span>
                    <span>oleh {entry.actorName}{entry.actorUsername ? ` (@${entry.actorUsername})` : ""}</span>
                  </p>
                  {(entry.beforeData || entry.afterData) && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11px] font-medium text-primary/80 hover:text-primary">Detail perubahan</summary>
                      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                        {entry.beforeData && (
                          <pre className="max-h-36 overflow-auto rounded-lg bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
                            {JSON.stringify(entry.beforeData, null, 2)}
                          </pre>
                        )}
                        {entry.afterData && (
                          <pre className="max-h-36 overflow-auto rounded-lg bg-primary/5 p-2 text-[10px] leading-relaxed text-primary/90">
                            {JSON.stringify(entry.afterData, null, 2)}
                          </pre>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Menampilkan {offset + 1}–{offset + entries.length} dari {total} entri
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Sebelumnya
              </Button>
              <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Berikutnya
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
