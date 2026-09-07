"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, History, Loader2, Package, RefreshCw } from "lucide-react";
import { apiGet, type AuditEntry, type AuditResponse } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

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

/**
 * Per-menu activity log: filters the global audit trail by entity type(s)
 * so each menu has its own clear, separated history.
 */
export function ActivityLogPanel({
  entityTypes,
  title = "Log Aktivitas",
  limit = 30,
  compact = false,
}: {
  entityTypes: string[];
  title?: string;
  limit?: number;
  compact?: boolean;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = entityTypes.map((t) => `entityType=${t}`).join("&");
      const res = await apiGet<AuditResponse["data"] & { meta: AuditResponse["meta"] }>(
        `/audit-logs?${query}&limit=${limit}`,
      );
      setEntries(res.data ?? (res as unknown as AuditEntry[]));
      setTotal(res.meta?.total ?? (res as unknown as AuditEntry[]).length ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat log aktivitas.");
    } finally {
      setLoading(false);
    }
  }, [entityTypes, limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {!loading && !error && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {total} entri
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} aria-label="Muat ulang log">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div className={cn("max-h-96 overflow-y-auto p-2", compact && "max-h-64")}>
        {error ? (
          <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="space-y-1 p-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <Package className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Belum ada aktivitas tercatat untuk menu ini.</p>
          </div>
        ) : (
          <ol className="relative ml-3 space-y-0 border-l pl-4">
            {entries.map((entry) => (
              <li key={entry.id} className="relative pb-4 pt-1 last:pb-1">
                <span className="absolute -left-[21px] top-1.5 flex h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      ACTION_STYLES[entry.action] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {entry.action}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {entry.entityLabel ?? `${entry.entityType} #${entry.entityId ?? "?"}`}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDate(entry.createdAt, true)}
                  <span>·</span>
                  <span>oleh {entry.actorName}</span>
                </p>
                {entry.afterData && Object.keys(entry.afterData).length > 0 && !compact && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-medium text-primary/80 hover:text-primary">
                      Detail perubahan
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
                      {JSON.stringify(entry.afterData, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
