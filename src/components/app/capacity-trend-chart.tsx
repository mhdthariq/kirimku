"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { History } from "lucide-react";
import { apiGet, type CapacityTrendResponse } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Capacity-config change trend (Capacity Round) — a small bar chart on the
 * dashboard showing how many vehicle capacity-config changes were audited per
 * day over the last 14 days. Helps spot days with lots of capacity tuning.
 * Informational. Gated on `vehicle.view` (the API enforces it).
 */
export function CapacityTrendChart({ days = 14 }: { days?: number }) {
  const { data, loading } = useApiData<CapacityTrendResponse>(
    () => apiGet<CapacityTrendResponse>(`/capacity/trend?days=${days}`),
    [days],
  );

  if (loading && !data) return <Skeleton className="h-[180px] w-full rounded-xl" />;
  const buckets = data?.buckets ?? [];
  const total = data?.total ?? 0;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <Card className="overflow-hidden border-l-4 border-l-indigo-400/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-500"><History className="h-4 w-4" /></span>
            Tren Perubahan Kapasitas
          </CardTitle>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {total} perubahan · {days} hari
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Frekuensi perubahan konfigurasi kapasitas kendaraan (max berat/volume/koli) — informatif.
        </p>
      </CardHeader>
      <CardContent>
        {buckets.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada data.</p>
        ) : (
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" stroke="#94a3b8" />
                <YAxis allowDecimals={false} tick={{ fontSize: 9 }} width={28} stroke="#94a3b8" />
                <Tooltip
                  cursor={{ fill: "#e2e8f0", opacity: 0.4 }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  labelFormatter={(l) => `Tanggal: ${l}`}
                  formatter={(v) => [`${v} perubahan`, "Kapasitas"]}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">
          {total === 0
            ? "Tidak ada perubahan kapasitas dalam periode ini."
            : `Rata-rata ${(total / days).toFixed(1)} perubahan/hari. Lihat detail di halaman Kapasitas Armada.`}
        </p>
      </CardContent>
    </Card>
  );
}
