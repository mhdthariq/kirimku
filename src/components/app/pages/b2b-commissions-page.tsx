"use client";

import { useMemo } from "react";
import { Briefcase, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, hasPermission, type CommissionRow, type Shipment } from "@/lib/client-api";
import { useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge, TypeBadge } from "@/components/app/status-badge";
import { formatRupiah, formatDate } from "@/components/app/form-parts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * B2B (Revise.md §31 Marketing menu) — the Marketing partner's B2B shipments
 * and their commission pipeline: komisi PENDING sampai invoice terkait LUNAS
 * penuh (§8/§9), lalu dikredit otomatis ke wallet.
 */
export function B2BCommissionsPage() {
  const { user } = useAuth();
  const isMarketing = user?.partnerType === "MARKETING";

  const { data: commissions, loading } = useApiData<CommissionRow[]>(
    () => (isMarketing ? apiGet<CommissionRow[]>("/commissions") : Promise.resolve([])),
    [isMarketing],
  );
  const { data: shipments } = useApiData<Shipment[]>(
    () => (isMarketing ? apiGet<Shipment[]>("/shipments?customerType=b2b") : Promise.resolve([])),
    [isMarketing],
  );

  const pendingTotal = useMemo(
    () => (commissions ?? []).filter((c) => c.status === "PENDING").reduce((s, c) => s + c.commissionAmount, 0),
    [commissions],
  );
  const releasedTotal = useMemo(
    () => (commissions ?? []).filter((c) => c.status === "RELEASED").reduce((s, c) => s + c.commissionAmount, 0),
    [commissions],
  );

  if (!isMarketing) {
    return (
      <PageHeader
        title="B2B"
        subtitle="Halaman ini khusus untuk partner Marketing — komisi B2B milik Anda."
        icon={<Briefcase className="h-5 w-5" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="B2B & Komisi"
        subtitle="Invoice B2B milik perusahaan — komisi Anda dirilis ke wallet hanya setelah invoice LUNAS penuh (§9)."
        icon={<Briefcase className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="rounded-xl border bg-chart-4/10 px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-chart-4">Komisi PENDING</p>
              <p className="text-base font-bold text-chart-4">{formatRupiah(pendingTotal)}</p>
            </div>
            <div className="rounded-xl border bg-primary/10 px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Komisi Dirilis</p>
              <p className="text-base font-bold text-primary">{formatRupiah(releasedTotal)}</p>
            </div>
          </div>
        }
      />

      <Tabs defaultValue="commissions">
        <TabsList>
          <TabsTrigger value="commissions">Status Komisi</TabsTrigger>
          <TabsTrigger value="shipments">Shipment B2B Saya</TabsTrigger>
        </TabsList>

        <TabsContent value="commissions" className="mt-3">
          <DataTable
            rows={commissions ?? []}
            loading={loading}
            emptyMessage="Belum ada invoice B2B yang membawa shipment Anda."
            columns={[
              {
                key: "invoice",
                header: "Invoice",
                primary: true,
                render: (r) => (
                  <div>
                    <p className="font-mono text-xs font-semibold">{r.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{r.customerName}</p>
                  </div>
                ),
              },
              { key: "invoiceStatus", header: "Invoice", render: (r) => <StatusBadge status={r.invoiceStatus} /> },
              {
                key: "paid",
                header: "Terbayar / Sisa",
                render: (r) => (
                  <div>
                    <p className="text-sm">{formatRupiah(r.paidAmount)} <span className="text-xs text-muted-foreground">/ {formatRupiah(r.invoiceAmount)}</span></p>
                    {r.remainingAmount > 0 ? (
                      <p className="text-xs text-chart-4">sisa {formatRupiah(r.remainingAmount)} — komisi belum rilis</p>
                    ) : (
                      <p className="text-xs text-primary">lunas</p>
                    )}
                  </div>
                ),
              },
              {
                key: "commission",
                header: `Komisi ${commissions?.[0]?.partnerPercent ?? 20}%`,
                render: (r) => <span className="font-semibold text-primary">{formatRupiah(r.commissionAmount)}</span>,
              },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt) },
            ]}
          />
        </TabsContent>

        <TabsContent value="shipments" className="mt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Pembayaran B2C customer untuk shipment Anda tidak dikelola sistem wallet — Anda yang menagih customer (§5.1).
          </p>
          <DataTable
            rows={shipments ?? []}
            loading={!shipments}
            emptyMessage="Belum ada shipment B2B."
            columns={[
              {
                key: "code",
                header: "Resi",
                primary: true,
                render: (r) => (
                  <a href={`#/shipments/${r.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {r.masterCode}
                  </a>
                ),
              },
              {
                key: "customer",
                header: "Customer",
                render: (r) => (
                  <div>
                    <p className="text-sm font-medium">{r.customer?.name}</p>
                    <TypeBadge type="b2b" />
                  </div>
                ),
              },
              { key: "route", header: "Rute", hideOnMobile: true, render: (r) => <span className="text-xs text-muted-foreground">{r.origin} → {r.destination}</span> },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              {
                key: "price",
                header: "Harga",
                render: (r) => (
                  <div>
                    <p className="text-sm">{formatRupiah(r.priceAmount)}</p>
                    {r.discountAmount > 0 && (
                      <p className="text-xs text-chart-4">
                        disc {formatRupiah(r.discountAmount)} → {formatRupiah(r.finalPriceAmount ?? (r.priceAmount ?? 0) - r.discountAmount)}
                      </p>
                    )}
                  </div>
                ),
              },
              { key: "date", header: "Tanggal", hideOnMobile: true, render: (r) => formatDate(r.createdAt) },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
