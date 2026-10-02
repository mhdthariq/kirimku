"use client";

import { useEffect, useState } from "react";
import { Clock, Gauge, History, X } from "lucide-react";
import { apiGet, type AuditEntry } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/components/app/form-parts";
import { cn } from "@/lib/utils";

/**
 * Vehicle Capacity History dialog (Capacity Round) — shows the audit trail of
 * capacity-config changes (maxWeightKg / maxVolumeM3 / maxKoli) for one
 * vehicle. Fetches `/audit-logs?entityType=vehicle&entityId=<id>` and filters
 * to entries whose `after.capacityConfigChanged` is true (or `before` contains
 * a capacity field).
 *
 * Triggered from the Fleet Capacity page's "Riwayat" button per row.
 */
export function VehicleCapacityHistoryDialog({
  vehicleId,
  vehicleNumber,
  open,
  onOpenChange,
}: {
  vehicleId: number | null;
  vehicleNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || vehicleId == null) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      apiGet<{ items?: AuditEntry[]; data?: AuditEntry[] } | AuditEntry[]>(
        `/audit-logs?entityType=vehicle&entityId=${vehicleId}&limit=200`,
      )
        .then((res) => {
          if (cancelled) return;
          const list = Array.isArray(res) ? res : (res.items ?? res.data ?? []);
          // Keep only entries that touched capacity config.
          const capacityEntries = list.filter((e) => {
            const after = e.afterData as Record<string, unknown> | null;
            const before = e.beforeData as Record<string, unknown> | null;
            if (after?.capacityConfigChanged) return true;
            if (before && (before.maxWeightKg || before.maxVolumeM3 || before.maxKoli)) return true;
            return false;
          });
          setEntries(capacityEntries);
        })
        .catch(() => { if (!cancelled) setEntries([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, vehicleId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><History className="h-4 w-4" /></span>
            Riwayat Kapasitas — {vehicleNumber}
          </DialogTitle>
          <DialogDescription>
            Perubahan konfigurasi kapasitas (max berat / volume / koli) untuk kendaraan ini.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Memuat…</p>
        ) : entries.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Belum ada perubahan konfigurasi kapasitas tercatat untuk kendaraan ini.
          </p>
        ) : (
          <ol className="relative ml-2 space-y-0 border-l pl-5">
            {entries.map((e) => {
              const changes = (e.afterData as Record<string, unknown> | null)?.capacityChanges as
                | { field: string; before: unknown; after: unknown }[]
                | undefined;
              return (
                <li key={e.id} className="relative pb-4 pt-1">
                  <span className="absolute -left-[21px] top-2 flex h-2.5 w-2.5 rounded-full border-2 border-card bg-amber-500" />
                  <div className="rounded-lg border bg-card p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <Gauge className="h-2.5 w-2.5" /> Kapasitas Diperbarui
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" /> {formatDate(e.createdAt, true)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      oleh {e.actorName}{e.actorUsername ? ` (@${e.actorUsername})` : ""}
                    </p>
                    {changes && changes.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {changes.map((c) => (
                          <div key={c.field} className="flex items-center gap-2 text-[11px]">
                            <span className="w-24 shrink-0 font-semibold text-muted-foreground">{fieldLabel(c.field)}</span>
                            <span className="font-mono text-muted-foreground line-through">{fmt(c.before)}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono font-semibold text-primary">{fmt(c.after)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] text-muted-foreground">Detail perubahan tidak tersedia.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" /> Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fieldLabel(field: string): string {
  switch (field) {
    case "maxWeightKg": return "Max Berat";
    case "maxVolumeM3": return "Max Volume";
    case "maxKoli": return "Max Koli";
    default: return field;
  }
}
function fmt(v: unknown): string {
  if (v == null) return "—";
  return String(v);
}
