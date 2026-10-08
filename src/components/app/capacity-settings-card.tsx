import { useState } from "react";
import { AlertTriangle, Gauge, Save } from "lucide-react";
import { apiGet, apiPut, type SettingsResponse } from "@/infrastructure/http/client-api";
import { useAuth } from "@/hooks/use-auth";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/utils";

/**
 * Capacity Settings card (Capacity Round) — owner-only section on the profile
 * page. Lets the owner configure the company-level capacity warning threshold
 * (%) — the utilization at which a dimension flips from OK → WARNING (near-limit,
 * plan §31 SOFT limit). Still informational; never blocks operations.
 */
export function CapacitySettingsCard() {
  const { user } = useAuth();
  const { data, loading, reload } = useApiData<SettingsResponse>(() => apiGet<SettingsResponse>("/settings"), []);
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = user?.isOwner;

  // Initialize the input once data arrives.
  const current = data?.capacity.warningThresholdPct ?? 90;
  if (data && threshold === "" && current) setThreshold(String(current));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(threshold);
    if (!Number.isFinite(v) || v < 1 || v > 99) return;
    setBusy(true);
    const ok = await runAction(
      () => apiPut("/settings", { warningThresholdPct: v }),
      { success: "Threshold kapasitas diperbarui." },
    );
    setBusy(false);
    if (ok) reload();
  }

  const v = Number(threshold);
  const valid = Number.isFinite(v) && v >= 1 && v <= 99;

  return (
    <Card className="overflow-hidden border-l-4 border-l-orange-400/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="rounded-lg bg-orange-500/10 p-1.5 text-orange-500"><Gauge className="h-4 w-4" /></span>
          Pengaturan Kapasitas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Konfigurasi level-perusahaan untuk monitoring kapasitas kendaraan — informatif, tidak memblokir operasi.
        </p>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : (
          <form onSubmit={onSave} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-50">
                <label htmlFor="warning-threshold" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Threshold Warning (%)
                </label>
                <Input
                  id="warning-threshold"
                  type="number"
                  min="1"
                  max="99"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  disabled={!isOwner || busy}
                  className="h-9 w-32"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Dimensi pada ≥ {threshold || current}% utilisasi (tapi belum over) ditandai <span className="font-semibold text-orange-600">Hampir Penuh</span>.
                </p>
              </div>
              {isOwner && (
                <Button type="submit" disabled={busy || !valid}>
                  <Save className="h-3.5 w-3.5" /> Simpan
                </Button>
              )}
            </div>

            {/* Preview of the threshold's effect */}
            <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
              <ThresholdPreview label="OK" pct={Math.max(0, (Number(threshold) || 90) - 1)} color="emerald" />
              <ThresholdPreview label="WARNING" pct={Number(threshold) || 90} color="orange" />
              <ThresholdPreview label="OVERLIMIT" pct={100} color="rose" />
              <ThresholdPreview label="UNCONFIGURED" pct={null} color="amber" />
            </div>

            <div className="flex items-start gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Ambang awal 90%. Status kapasitas bersifat <span className="font-semibold">informatif</span> — resi tetap
                dapat ditugaskan meskipun muatan melebihi kapasitas.
              </p>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ThresholdPreview({ label, pct, color }: { label: string; pct: number | null; color: "emerald" | "orange" | "rose" | "amber" }) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 border-emerald-200",
    orange: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 border-orange-200",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 border-rose-200",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 border-amber-200",
  }[color];
  return (
    <div className={cn("rounded-lg border px-2 py-1.5", cls)}>
      <p className="font-bold">{label}</p>
      <p className="text-[9px]">{pct != null ? `≥ ${pct}%` : "null"}</p>
    </div>
  );
}
