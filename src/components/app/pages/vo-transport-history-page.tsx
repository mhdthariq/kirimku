"use client";

import { useMemo, useState } from "react";
import { Eye, History, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type VOTransportRow } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Vehicle Owner — Transport History (Revise.md §16) + Earnings (§32):
 * every transport performed with THEIR vehicles, with transport value,
 * profit-share percentage and owner earnings. Settled rows use the
 * settlement snapshot (§37); unsettled rows preview the current config.
 */
export function VOTransportHistoryPage({ initialTab = "history" }: { initialTab?: "history" | "earnings" }) {
  const { user } = useAuth();
  const canView = hasPermission(user, "transport.view_own_vehicles");
  const { data, loading } = useApiData<VOTransportRow[]>(() => apiGet<VOTransportRow[]>("/partner/transports"), []);
  const [vehicleFilter, setVehicleFilter] = useState("all");

  const rows = useMemo(() => {
    const list = data ?? [];
    if (vehicleFilter === "all") return list;
    return list.filter((r) => String(r.vehicleNumber) === vehicleFilter);
  }, [data, vehicleFilter]);

  const vehicles = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.vehicleNumber))), [data]);

  const settled = rows.filter((r) => r.settlement);
  const unsettled = rows.filter(
    (r) => !r.settlement && r.transportValue > 0 && ["ARRIVED", "DEPARTED"].includes(r.status),
  );
  const totalEarnings = settled.reduce((sum, r) => sum + (r.settlement?.ownerAmount ?? 0), 0);
  const totalValue = settled.reduce((sum, r) => sum + (r.settlement?.transportValue ?? 0), 0);
  // Potential earnings not settled yet — what the owner COULD earn from
  // finished transports still awaiting settlement (current config preview).
  const potentialEarnings = unsettled.reduce((sum, r) => sum + (r.transportValue * r.ownerPercent) / 100, 0);

  /** Potential (unsettled) earnings for a single row — amber/yellow. */
  const estimateFor = (r: (typeof rows)[number]) => Math.round((r.transportValue * r.ownerPercent) / 100);

  if (!canView || user?.partnerType !== "VEHICLE_OWNER") {
    return <PageHeader title="Riwayat Transport" subtitle="Halaman ini khusus untuk Vehicle Owner." icon={<History className="h-5 w-5" />} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transport & Earnings"
        subtitle="Riwayat transport dengan kendaraan Anda — nilai transport, persentase, dan penghasilan Anda."
        icon={<History className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border bg-primary/10 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Total earnings</p>
            <p className="text-base font-bold text-primary">{formatRupiah(totalEarnings)}</p>
          </div>
        }
      />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="history">Riwayat Transport</TabsTrigger>
          <TabsTrigger value="earnings">Ringkasan Earnings</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-3 space-y-3">
          {vehicles.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip active={vehicleFilter === "all"} onClick={() => setVehicleFilter("all")}>Semua Kendaraan</FilterChip>
              {vehicles.map((v) => (
                <FilterChip key={v} active={vehicleFilter === v} onClick={() => setVehicleFilter(v)}>{v}</FilterChip>
              ))}
            </div>
          )}
          <DataTable
            rows={rows}
            loading={loading}
            emptyMessage="Belum ada transport dengan kendaraan Anda."
            columns={[
              {
                key: "transport",
                header: "Transport",
                primary: true,
                render: (r) => (
                  <div>
                    <p className="font-mono text-xs font-semibold">{r.transportCode}</p>
                    <p className="text-xs text-muted-foreground">{r.routeName}</p>
                  </div>
                ),
              },
              {
                key: "vehicle",
                header: "Kendaraan",
                render: (r) => <span className="font-mono text-xs">{r.vehicleNumber}</span>,
              },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              {
                key: "value",
                header: "Nilai Transport",
                hideOnMobile: true,
                render: (r) => <span className="text-sm">{r.transportValue > 0 ? formatRupiah(r.transportValue) : "—"}</span>,
              },
              {
                key: "percent",
                header: "Bagian Anda",
                hideOnMobile: true,
                render: (r) => <span className="text-sm font-medium">{r.ownerPercent}%</span>,
              },
              {
                key: "earnings",
                header: "Penghasilan",
                render: (r) =>
                  r.settlement ? (
                    // settled → GREEN (already in the wallet)
                    <div>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{formatRupiah(r.settlement.ownerAmount)}</span>
                      <p className="text-[10px] font-medium text-emerald-600/80 dark:text-emerald-400/80">sudah disettle</p>
                    </div>
                  ) : r.transportValue > 0 && ["ARRIVED", "DEPARTED"].includes(r.status) ? (
                    // not settled yet → YELLOW with the potential amount
                    <div>
                      <span className="font-semibold text-amber-500 dark:text-yellow-400">~{formatRupiah(estimateFor(r))}</span>
                      <p className="text-[10px] font-medium text-amber-500/80 dark:text-yellow-400/80">potensi — belum disettle</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">belum disettle</span>
                  ),
              },
              { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.departedAt ?? r.createdAt) },
              {
                key: "actions",
                header: "Aksi",
                render: (r) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => (window.location.hash = `#/transports/${r.id}`)}
                    title="Lihat detail transport — muatan kendaraan Anda & posisinya"
                  >
                    <Eye className="h-3.5 w-3.5" /> Detail
                  </Button>
                ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="earnings" className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <SummaryTile label="Total Nilai Transport Disettle" value={formatRupiah(totalValue)} icon={<History className="h-4 w-4" />} />
            <SummaryTile label="Total Earnings Anda" value={formatRupiah(totalEarnings)} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-600 dark:text-emerald-400" />
            <SummaryTile label="Jumlah Settlement" value={`${settled.length}×`} icon={<TrendingUp className="h-4 w-4" />} />
            {/* Potential (unsettled) earnings — YELLOW so the owner knows what
                they could still earn from transports awaiting settlement. */}
            <SummaryTile
              label="Potensi Belum Disettle"
              value={formatRupiah(potentialEarnings)}
              icon={<TrendingUp className="h-4 w-4" />}
              accent="text-amber-500 dark:text-yellow-400"
            />
          </div>
          {potentialEarnings > 0 && (
            <p className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              Anda punya <b>{unsettled.length} transport selesai</b> yang belum di-settle — potensi penghasilan <b className="text-amber-600 dark:text-yellow-400">~{formatRupiah(potentialEarnings)}</b> (dihitung dari konfigurasi profit sharing saat ini, berupa warna kuning sampai disettle).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Setiap settlement menyimpan persentase saat settlement dibuat — perubahan konfigurasi profit sharing di kemudian hari tidak mengubah settlement lama (§37).
          </p>
          <DataTable
            rows={settled}
            loading={loading}
            emptyMessage="Belum ada settlement."
            columns={[
              {
                key: "code",
                header: "Settlement",
                primary: true,
                render: (r) => <span className="font-mono text-xs font-semibold">{r.settlement?.settlementCode}</span>,
              },
              {
                key: "split",
                header: "Profit Share",
                render: (r) => (
                  <div className="text-xs">
                    <p className="font-semibold">{r.settlement?.ownerPercent}% Anda · {r.settlement?.companyPercent}% Perusahaan</p>
                    <p className="text-muted-foreground">
                      nilai {formatRupiah(r.settlement?.transportValue ?? 0)} · perusahaan {formatRupiah(r.settlement?.companyAmount ?? 0)}
                    </p>
                  </div>
                ),
              },
              {
                key: "earnings",
                header: "Penghasilan Anda",
                render: (r) => <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{formatRupiah(r.settlement?.ownerAmount ?? 0)}</span>,
              },
              { key: "date", header: "Finalisasi", hideOnMobile: true, render: (r) => formatDate(r.settlement?.finalizedAt) },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryTile({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={`mt-1 text-xl font-bold ${accent ?? ""}`}>{value}</p>
    </div>
  );
}
