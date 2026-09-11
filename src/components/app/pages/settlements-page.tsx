"use client";

import { useMemo, useState } from "react";
import { Briefcase, CheckCircle2, Coins, Route as RouteIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiGet, apiPost, hasPermission, type Invoice, type Transport } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, NumberInput, SubmitButton, formatRupiah, formatDate } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SettleableTransport extends Transport {
  vehicleOwnerId: number | null;
  vehicleOwnerName: string | null;
  settlement: {
    settlementCode: string;
    status: string;
    transportValue: number;
    companyPercent: number;
    ownerPercent: number;
    companyAmount: number;
    ownerAmount: number;
    finalizedAt: string | null;
  } | null;
}

/**
 * Partner Settlements (Revise.md §33/§34) — company side:
 *  · Transport settlements: finalize ARRIVED partner-vehicle transports —
 *    snapshots the profit-share split and credits the Vehicle Owner wallet
 *    atomically (§14/§15/§30).
 *  · Marketing commissions: PENDING until the B2B invoice is FULLY PAID (§8/§9)
 *    — released automatically by the invoice settlement flow.
 */
export function SettlementsPage() {
  const { user } = useAuth();
  const canSettle = hasPermission(user, "transport.settle");
  const canViewInvoices = hasPermission(user, "invoice.view");

  const { data: transports, loading, reload } = useApiData<SettleableTransport[]>(
    () => apiGet<SettleableTransport[]>("/transports?status=ARRIVED"),
    [],
  );
  const { data: invoices, reload: reloadInvoices } = useApiData<Invoice[]>(() => apiGet<Invoice[]>("/invoices"), []);

  const [settleFor, setSettleFor] = useState<SettleableTransport | null>(null);

  const arrived = transports ?? [];
  const partnerArrived = useMemo(() => arrived.filter((t) => t.vehicleOwnerId != null), [arrived]);
  const settledAll = useMemo(() => (transports ?? []).filter((t) => t.settlement), [transports]);
  const commissionInvoices = (invoices ?? []).filter((i) => i.commission);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner Settlements"
        subtitle="Settlement transport (profit share Vehicle Owner) & status komisi B2B Marketing."
        icon={<Coins className="h-5 w-5" />}
      />

      <Tabs defaultValue="transport">
        <TabsList>
          <TabsTrigger value="transport">Settlement Transport</TabsTrigger>
          <TabsTrigger value="commission">Komisi B2B Marketing</TabsTrigger>
        </TabsList>

        <TabsContent value="transport" className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Transport ARRIVED dengan kendaraan partner bisa difinalisasi — nilai transport & persentase di-snapshot permanen (§37), profit share dikredit ke wallet Vehicle Owner secara atomik.
          </p>
          <DataTable
            rows={partnerArrived}
            loading={loading}
            emptyMessage="Tidak ada transport ARRIVED milik partner yang menunggu settlement."
            columns={[
              {
                key: "code",
                header: "Transport",
                primary: true,
                render: (r) => (
                  <div>
                    <p className="font-mono text-xs font-semibold">{r.transportCode}</p>
                    <p className="text-xs text-muted-foreground">{r.routeName ?? `${r.origin} → ${r.destination}`}</p>
                  </div>
                ),
              },
              {
                key: "owner",
                header: "Vehicle Owner",
                render: (r) => (
                  <div>
                    <p className="text-sm font-medium">{r.vehicleOwnerName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{r.vehicleNumber}</p>
                  </div>
                ),
              },
              {
                key: "value",
                header: "Nilai Shipment",
                render: (r) => <span className="text-sm">{r.totalPrice != null ? formatRupiah(r.totalPrice) : "—"}</span>,
              },
              {
                key: "settlement",
                header: "Settlement",
                render: (r) =>
                  r.settlement ? (
                    <div>
                      <p className="font-mono text-xs font-semibold">{r.settlement.settlementCode}</p>
                      <p className="text-xs text-primary">+{formatRupiah(r.settlement.ownerAmount)} ({r.settlement.ownerPercent}%)</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">belum</span>
                  ),
              },
              { key: "arrived", header: "Tiba", hideOnMobile: true, render: (r) => formatDate(r.arrivedAt) },
              {
                key: "actions",
                header: "Aksi",
                render: (r) =>
                  r.settlement ? (
                    <StatusBadge status={r.settlement.status} />
                  ) : canSettle ? (
                    <Button size="sm" className="h-7" onClick={() => setSettleFor(r)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Settle
                    </Button>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />

          {settledAll.length > 0 && (
            <section className="rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <RouteIcon className="h-4 w-4" /> Riwayat Settlement ({settledAll.length})
                </p>
              </div>
              <div className="divide-y">
                {settledAll.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {t.transportCode} <span className="text-xs font-normal text-muted-foreground">· {t.vehicleOwnerName} · {t.vehicleNumber}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        nilai {formatRupiah(t.settlement?.transportValue ?? 0)} · perusahaan {formatRupiah(t.settlement?.companyAmount ?? 0)} ({t.settlement?.companyPercent}%)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">+{formatRupiah(t.settlement?.ownerAmount ?? 0)}</p>
                      <p className="text-[10px] text-muted-foreground">{t.settlement?.ownerPercent}% · {formatDate(t.settlement?.finalizedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </TabsContent>

        <TabsContent value="commission" className="mt-3 space-y-3">
          {!canViewInvoices ? (
            <p className="text-sm text-muted-foreground">Anda tidak memiliki izin melihat invoice.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Komisi Marketing berstatus <b>PENDING</b> sampai invoice <b>LUNAS penuh</b> — pembayaran parsial tidak merilis komisi (§8.1). Pelunasan invoice otomatis mengkredit wallet Marketing (atomic).
              </p>
              <DataTable
                rows={commissionInvoices}
                loading={!invoices}
                emptyMessage="Belum ada invoice dengan komisi Marketing."
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
                  {
                    key: "partner",
                    header: "Marketing",
                    render: (r) => <span className="text-sm font-medium">{r.commission?.partnerName}</span>,
                  },
                  { key: "total", header: "Nilai Invoice", render: (r) => formatRupiah(r.totalAmount) },
                  {
                    key: "paid",
                    header: "Terbayar / Sisa",
                    hideOnMobile: true,
                    render: (r) => (
                      <div>
                        <p className="text-sm">{formatRupiah(r.settledAmount)}</p>
                        {r.remainingAmount > 0 && <p className="text-xs text-destructive">sisa {formatRupiah(r.remainingAmount)}</p>}
                      </div>
                    ),
                  },
                  {
                    key: "commission",
                    header: `Komisi (${commissionInvoices[0]?.commission?.partnerPercent ?? 20}%)`,
                    render: (r) => <span className="font-semibold text-primary">{formatRupiah(r.commission?.commissionAmount ?? 0)}</span>,
                  },
                  {
                    key: "status",
                    header: "Status Komisi",
                    render: (r) => <StatusBadge status={r.commission?.status ?? "PENDING"} />,
                  },
                  {
                    key: "actions",
                    header: "Aksi",
                    render: (r) =>
                      r.status !== "SETTLED" && r.remainingAmount > 0 && hasPermission(user, "payment.verify") ? (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => window.location.assign(`#/invoices`)}>
                          Catat Pembayaran
                        </Button>
                      ) : (
                        "—"
                      ),
                  },
                ]}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <SettleTransportDialog transport={settleFor} onOpenChange={(open) => !open && setSettleFor(null)} onDone={() => { reload(); reloadInvoices(); }} />
    </div>
  );
}

function SettleTransportDialog({
  transport,
  onOpenChange,
  onDone,
}: {
  transport: SettleableTransport | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const suggested = transport?.totalPrice ?? 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transport) return;
    const transportValue = Number(value || suggested);
    if (!transportValue || transportValue <= 0) return;
    setBusy(true);
    const ok = await runAction(() => apiPost(`/transports/${transport.id}/settle`, { transportValue }), {
      success: "Settlement difinalisasi — profit share dikredit ke wallet Vehicle Owner (atomic).",
    });
    if (ok) {
      setValue("");
      onOpenChange(false);
      onDone();
    }
    setBusy(false);
  }

  return (
    <Dialog open={!!transport} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle Transport {transport?.transportCode}</DialogTitle>
          <DialogDescription>
            Kendaraan {transport?.vehicleNumber} · Vehicle Owner {transport?.vehicleOwnerName}. Nilai & persentase di-snapshot permanen untuk settlement ini (§37).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            label="Nilai Transport (Rupiah)"
            hint={suggested > 0 ? `Disarankan dari total harga shipment termuat: ${formatRupiah(suggested)}` : "Shipment belum diharga — masukkan nilai manual."}
          >
            <NumberInput
              value={value || (suggested > 0 ? String(suggested) : "")}
              onChange={(e) => setValue(e.target.value)}
              min={1}
              required
            />
          </Field>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Briefcase className="h-3.5 w-3.5" />
              <span>Nilai & persentase dihitung ulang saat submit mengikuti konfigurasi profit share partner saat ini.</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            <SubmitButton busy={busy}>Finalisasi Settlement</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
