"use client";

import { useMemo, useState } from "react";
import { History, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type VOTransportRow } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
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
  const totalEarnings = settled.reduce((sum, r) => sum + (r.settlement?.ownerAmount ?? 0), 0);
  const totalValue = settled.reduce((sum, r) => sum + (r.settlement?.transportValue ?? 0), 0);

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
                    <span className="font-semibold text-primary">+{formatRupiah(r.settlement.ownerAmount)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">belum disettle</span>
                  ),
              },
              { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.departedAt ?? r.createdAt) },
            ]}
          />
        </TabsContent>

        <TabsContent value="earnings" className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryTile label="Total Nilai Transport Disettle" value={formatRupiah(totalValue)} icon={<History className="h-4 w-4" />} />
            <SummaryTile label="Total Earnings Anda" value={formatRupiah(totalEarnings)} icon={<TrendingUp className="h-4 w-4" />} accent="text-primary" />
            <SummaryTile label="Jumlah Settlement" value={`${settled.length}×`} icon={<TrendingUp className="h-4 w-4" />} />
          </div>
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
                render: (r) => <span className="font-semibold text-primary">+{formatRupiah(r.settlement?.ownerAmount ?? 0)}</span>,
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
