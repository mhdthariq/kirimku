"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Coins, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type UnpaidShipment } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";

export function UnpaidPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "payment.unpaid.view"),
    verify: hasPermission(user, "payment.verify"),
  };
  const { data, loading, reload } = useApiData<UnpaidShipment[]>(() => apiGet<UnpaidShipment[]>("/unpaid"), []);
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  async function verifyPayment(shipmentId: number, paymentId: number) {
    const ok = await runAction(() => apiPost(`/payments/${paymentId}/verify`), { success: "Pembayaran diverifikasi." });
    if (ok) reload();
  }

  if (!can.view) {
    return <PageHeader title="B2C Belum Bayar" subtitle="Anda tidak memiliki izin melihat data ini." />;
  }

  const totalRemaining = rows.reduce((sum, r) => sum + r.remainingAmount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="B2C Belum Bayar"
        subtitle="Shipment B2C yang sudah diharga namun belum lunas (settling kas kurir)."
        icon={<Coins className="h-5 w-5" />}
        actions={
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">Total sisa</p>
            <p className="text-base font-bold text-destructive">{formatRupiah(totalRemaining)}</p>
          </div>
        }
      />

      <DataTable
        rows={rows}
        loading={loading}
        search=""
        emptyMessage="Semua shipment B2C sudah lunas atau belum ada yang diharga."
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
                <p className="text-sm font-medium">{r.customerName}</p>
                {r.customerPhone && <p className="text-xs text-muted-foreground">{r.customerPhone}</p>}
              </div>
            ),
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          {
            key: "price",
            header: "Harga / Sisa",
            render: (r) => (
              <div>
                <p className="text-sm">{formatRupiah(r.priceAmount)}</p>
                <p className={`text-xs font-semibold ${r.remainingAmount > 0 ? "text-destructive" : "text-primary"}`}>
                  sisa {formatRupiah(r.remainingAmount)}
                </p>
              </div>
            ),
          },
          { key: "pending", header: "Menunggu Verifikasi", hideOnMobile: true, render: (r) => (r.pendingAmount > 0 ? <span className="font-semibold text-chart-4">{formatRupiah(r.pendingAmount)}</span> : "—") },
          {
            key: "actions",
            header: "Pembayaran",
            render: (r) => (
              <div className="space-y-1.5">
                {r.payments.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <Wallet className="h-3.5 w-3.5" /> {r.payments.length} transaksi
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Expanded payments */}
      {expanded != null && (
        <Card>
          {rows
            .filter((r) => r.id === expanded)
            .map((r) => (
              <div key={r.id} className="rounded-xl border bg-card">
                <div className="border-b px-4 py-3">
                  <p className="text-sm font-semibold">Pembayaran {r.masterCode}</p>
                </div>
                <div className="divide-y">
                  {r.payments.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {formatRupiah(p.amount)} <span className="text-xs font-normal text-muted-foreground">· {p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(p.createdAt, true)} · dicatat {p.recordedByName ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        {p.status === "RECORDED" && can.verify && (
                          <Button size="sm" variant="secondary" className="h-7" onClick={() => verifyPayment(r.id, p.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Verifikasi
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </Card>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
