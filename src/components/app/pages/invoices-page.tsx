"use client";

import { useMemo, useState } from "react";
import { Plus, Printer, Receipt, Send, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiGet, apiPost, hasPermission, type Invoice, type InvoiceLine, type Options } from "@/lib/client-api";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { PageHeader, DataTable } from "@/components/app/data-table";
import { ActivityLogPanel } from "@/components/app/activity-log-panel";
import { StatusBadge } from "@/components/app/status-badge";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoicePrint } from "@/components/app/invoice-print";

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
  /** Revise.md §7.1 — optional link to the billed B2B shipment */
  shipmentId: string;
}

interface InvoiceForm {
  customerId: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: DraftLine[];
}

const EMPTY: InvoiceForm = {
  customerId: "",
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  notes: "",
  lines: [{ description: "", quantity: "1", unitPrice: "", shipmentId: "" }],
};

export function InvoicesPage() {
  const { user } = useAuth();
  const can = {
    view: hasPermission(user, "invoice.view"),
    create: hasPermission(user, "invoice.create"),
    update: hasPermission(user, "invoice.update"),
    send: hasPermission(user, "invoice.send"),
    settle: hasPermission(user, "payment.verify"),
  };

  const { data, loading, reload } = useApiData<Invoice[]>(() => apiGet<Invoice[]>("/invoices"), []);
  const { data: options } = useApiData<Options>(() => apiGet<Options>("/options"), []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<InvoiceForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleMethod, setSettleMethod] = useState("TRANSFER");
  const [settleRef, setSettleRef] = useState("");
  const [printOpen, setPrintOpen] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.filter(
      (inv) =>
        (statusFilter === "all" || inv.status === statusFilter) &&
        (!q || inv.invoiceNumber.toLowerCase().includes(q) || inv.customerName.toLowerCase().includes(q)),
    );
  }, [data, search, statusFilter]);

  const detailWithLines = useMemo(() => {
    if (!detail) return null;
    const base = data?.find((inv) => inv.id === detail.id);
    return base ?? detail;
  }, [detail, data]);

  async function loadDetail(inv: Invoice) {
    try {
      const full = await apiGet<Invoice & { lines: InvoiceLine[] }>(`/invoices/${inv.id}`);
      setDetail(full);
    } catch {
      toast.error("Gagal memuat detail invoice.");
    }
  }

  function openCreate() {
    setForm({ ...EMPTY, lines: [{ description: "", quantity: "1", unitPrice: "", shipmentId: "" }] });
    setCreateOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      customerId: Number(form.customerId),
      issueDate: form.issueDate || null,
      dueDate: form.dueDate || null,
      notes: form.notes || null,
      lines: form.lines
        .filter((l) => l.description.trim() && Number(l.unitPrice) > 0)
        .map((l) => ({
          description: l.description,
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice),
          // Revise.md §7.1 — link the line to its B2B shipment so the
          // Marketing commission attaches to this invoice (§8).
          shipmentId: l.shipmentId ? Number(l.shipmentId) : null,
        })),
    };
    const ok = await runAction(() => apiPost("/invoices", payload), { success: "Invoice draft dibuat — komisi Marketing (bila ada) otomatis terlacak PENDING." });
    setBusy(false);
    if (ok) {
      setCreateOpen(false);
      reload();
    }
  }

  async function onSend(inv: Invoice) {
    const ok = await runAction(() => apiPost(`/invoices/${inv.id}/send`, {}), {
      success: `Invoice ${inv.invoiceNumber} dikirim — baris item terkunci.`,
    });
    if (ok) reload();
  }

  async function onDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    const ok = await runAction(() => apiDelete(`/invoices/${target.id}`), { success: "Invoice dihapus." });
    if (ok) reload();
  }

  async function onSettle(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    const ok = await runAction(
      () =>
        apiPost(`/invoices/${detail.id}/settlements`, {
          amount: Number(settleAmount),
          method: settleMethod,
          reference: settleRef || null,
        }),
      {
        success:
          Number(settleAmount) >= (detail.remainingAmount ?? 0) - 0.01 && detail.commission
            ? "Pelunasan dicatat — komisi Marketing dirilis ke wallet (atomic, §9)."
            : "Settlement dicatat — pembayaran parsial, komisi tetap PENDING (§8.1).",
      },
    );
    setBusy(false);
    if (ok) {
      setSettleOpen(false);
      setSettleAmount("");
      setSettleRef("");
      reload();
      loadDetail(detail);
    }
  }

  if (!can.view) {
    return <PageHeader title="Invoice" subtitle="Anda tidak memiliki izin melihat invoice." />;
  }

  const b2bCustomers = (options?.customers ?? []).filter((c) => c.type === "b2b");
  const customerOptions = b2bCustomers.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }));
  const draftLinesTotal = form.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoice"
        subtitle="Tagihan B2B per customer — draft, kirim, dan settlement bertahap."
        icon={<Receipt className="h-5 w-5" />}
        actions={
          can.create && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> Buat Invoice
            </Button>
          )
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Daftar</TabsTrigger>
          <TabsTrigger value="activity">Log Aktivitas</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-3">
          <DataTable
            rows={rows}
            loading={loading}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Cari nomor / customer…"
            toolbar={
              <div className="flex max-w-full flex-wrap items-center gap-1.5">
                {["all", "DRAFT", "SENT", "PARTIALLY_SETTLED", "SETTLED"].map((s) => (
                  <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} className="h-7 px-2.5 text-[11px]" onClick={() => setStatusFilter(s)}>
                    {s === "all" ? "Semua" : s === "PARTIALLY_SETTLED" ? "PARTIAL" : s}
                  </Button>
                ))}
              </div>
            }
            emptyMessage="Belum ada invoice B2B."
            columns={[
              {
                key: "number",
                header: "Nomor",
                primary: true,
                render: (inv) => (
                  <button onClick={() => (window.location.hash = `#/invoices/${inv.id}`)} className="font-mono text-xs font-semibold text-primary hover:underline">
                    {inv.invoiceNumber}
                  </button>
                ),
              },
              {
                key: "customer",
                header: "Customer",
                render: (inv) => (
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.customerName}</p>
                    <p className="text-xs text-muted-foreground">{inv.linesCount} baris item</p>
                  </div>
                ),
              },
              {
                key: "amount",
                header: "Total",
                render: (inv) => (
                  <div>
                    <p className="text-sm font-semibold">{formatRupiah(inv.totalAmount)}</p>
                    {inv.remainingAmount > 0 && inv.settledAmount > 0 && (
                      <p className="text-[11px] text-muted-foreground">sisa {formatRupiah(inv.remainingAmount)}</p>
                    )}
                  </div>
                ),
              },
              { key: "due", header: "Jatuh Tempo", hideOnMobile: true, render: (inv) => formatDate(inv.dueDate) },
              {
                key: "status",
                header: "Status",
                render: (inv) => (
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={inv.status} />
                    {inv.isOverdue && <span className="text-[10px] font-semibold text-destructive">OVERDUE</span>}
                    {inv.commission && (
                      <span className="text-[10px] font-medium text-primary" title={`Komisi ${inv.commission.partnerName}`}>
                        komisi {formatRupiah(inv.commission.commissionAmount)} · {inv.commission.status}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "actions",
                header: "Aksi",
                render: (inv) => (
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => (window.location.hash = `#/invoices/${inv.id}`)}>
                      Detail
                    </Button>
                    {inv.status === "DRAFT" && can.send && (
                      <Button size="sm" className="h-7" onClick={() => onSend(inv)}>
                        <Send className="h-3.5 w-3.5" /> Kirim
                      </Button>
                    )}
                    {(inv.status === "SENT" || inv.status === "PARTIALLY_SETTLED") && can.settle && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={() => {
                          loadDetail(inv);
                          setSettleAmount(String(Math.round(inv.remainingAmount)));
                          setSettleOpen(true);
                        }}
                      >
                        <Wallet className="h-3.5 w-3.5" /> Settle
                      </Button>
                    )}
                    {inv.status === "DRAFT" && can.update && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(inv)} aria-label="Hapus invoice">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityLogPanel entityTypes={["invoice", "invoice_line"]} />
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Buat Invoice (Draft)</DialogTitle>
            <DialogDescription>Pilih customer B2B lalu isi baris item. Baris item bisa ditambah/dihapus selama status DRAFT.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer B2B" htmlFor="inv-customer">
                <FormSelect
                  value={form.customerId}
                  onValueChange={(v) => setForm({ ...form, customerId: v })}
                  placeholder={customerOptions.length ? "Pilih customer…" : "Belum ada customer B2B"}
                  options={customerOptions}
                  disabled={busy || customerOptions.length === 0}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Tanggal terbit" htmlFor="inv-issue">
                  <Input id="inv-issue" type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} disabled={busy} />
                </Field>
                <Field label="Jatuh tempo" htmlFor="inv-due">
                  <Input id="inv-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} disabled={busy} />
                </Field>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Baris item</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { description: "", quantity: "1", unitPrice: "", shipmentId: "" }] }))}
                  disabled={busy}
                >
                  <Plus className="h-3.5 w-3.5" /> Baris
                </Button>
              </div>
              {/* Revise.md §7.1 — pick the customer's B2B shipments to bill;
                  linked Marketing shipments attach the commission (§8). */}
              {(() => {
                const allCustomerShipments = (options?.b2bShipments ?? []).filter(
                  (s) => !form.customerId || s.customerId === Number(form.customerId),
                );
                const customerShipments = allCustomerShipments.filter((s) => s.invoiceLines.length === 0);
                const linkedPartner = form.lines
                  .map((l) => customerShipments.find((s) => String(s.id) === l.shipmentId)?.createdByPartnerId ?? null)
                  .find((p) => p != null);
                return (
                  <>
                    <div className="space-y-2">
                      {form.lines.map((line, i) => (
                        <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_36px]">
                            <FormSelect
                              value={line.shipmentId}
                              onValueChange={(shipmentId) => {
                                const picked = customerShipments.find((s) => String(s.id) === shipmentId);
                                setForm((f) => ({
                                  ...f,
                                  lines: f.lines.map((l, idx) =>
                                    idx === i
                                      ? {
                                          ...l,
                                          shipmentId,
                                          ...(picked && !l.description
                                            ? {
                                                description: `${picked.masterCode} — pengiriman ${picked.origin} → ${picked.destination}`,
                                                unitPrice: String(picked.priceAmount ?? ""),
                                              }
                                            : {}),
                                        }
                                      : l,
                                  ),
                                }));
                              }}
                              placeholder="— tanpa link shipment —"
                              options={customerShipments.map((s) => ({
                                value: String(s.id),
                                label: `${s.masterCode} · ${formatRupiah(s.priceAmount)}${s.createdByPartnerId ? " · marketing" : ""}`,
                              }))}
                              disabled={busy}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))}
                              disabled={busy || form.lines.length === 1}
                              aria-label="Hapus baris"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-[1fr_70px_100px] items-center gap-2">
                            <Input
                              value={line.description}
                              onChange={(e) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, description: e.target.value } : l)) }))}
                              placeholder={`Deskripsi item ${i + 1}`}
                              disabled={busy}
                              aria-label={`Deskripsi item ${i + 1}`}
                            />
                            <NumberInput
                              value={line.quantity}
                              onChange={(e) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)) }))}
                              placeholder="Qty"
                              disabled={busy}
                              aria-label={`Jumlah item ${i + 1}`}
                            />
                            <NumberInput
                              value={line.unitPrice}
                              onChange={(e) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, unitPrice: e.target.value } : l)) }))}
                              placeholder="Harga"
                              disabled={busy}
                              aria-label={`Harga item ${i + 1}`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {allCustomerShipments.some((s) => s.invoiceLines.length > 0) && (
                      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        {allCustomerShipments.filter((s) => s.invoiceLines.length > 0).length} shipment sudah termasuk invoice dan tidak bisa ditagihkan ulang.
                      </p>
                    )}
                    {linkedPartner != null && (
                      <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-primary">
                        Invoice ini membawa shipment buatan Marketing — komisi partner akan tercatat <b>PENDING</b> dan hanya dirilis saat invoice <b>LUNAS penuh</b> (§8/§9).
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center justify-end gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total draft:</span>
                <span className="font-bold text-foreground">{formatRupiah(draftLinesTotal)}</span>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Buat Invoice Draft</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailWithLines} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-4 pr-4">
              <div>
                <DialogTitle className="font-mono text-xl tracking-tight">{detailWithLines?.invoiceNumber}</DialogTitle>
                <DialogDescription className="mt-1">Invoice B2B · diterbitkan {formatDate(detailWithLines?.issueDate)}</DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {detailWithLines && <StatusBadge status={detailWithLines.status} />}
                <Button variant="outline" size="sm" onClick={() => setPrintOpen(true)} disabled={!detailWithLines || !("lines" in detailWithLines)}>
                  <Printer className="h-4 w-4" /> Cetak
                </Button>
              </div>
            </div>
          </DialogHeader>
          {detailWithLines && "lines" in detailWithLines && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ditagihkan kepada</p>
                  <p className="mt-1 font-semibold text-foreground">{(detailWithLines as Invoice & { customer?: { companyName?: string | null } }).customer?.companyName ?? detailWithLines.customerName}</p>
                  <p className="text-xs text-muted-foreground">{detailWithLines.customerCode}</p>
                  {(detailWithLines as Invoice & { customer?: { address?: string | null } }).customer?.address && <p className="mt-1 text-xs text-muted-foreground">{(detailWithLines as Invoice & { customer?: { address?: string | null } }).customer?.address}</p>}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tanggal pembayaran</p>
                  <div className="mt-1 grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-muted-foreground">Jatuh tempo</p><p className="font-semibold">{formatDate(detailWithLines.dueDate)}</p></div>
                    <div><p className="text-muted-foreground">Status</p><p className={detailWithLines.isOverdue ? "font-semibold text-destructive" : "font-semibold"}>{detailWithLines.isOverdue ? "Terlambat" : detailWithLines.status === "SETTLED" ? "Lunas" : "Belum lunas"}</p></div>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Deskripsi</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Harga satuan</th>
                      <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailWithLines as Invoice & { lines: InvoiceLine[] }).lines?.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(line.quantity)}</td>
                        <td className="px-3 py-2 text-right">{formatRupiah(line.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatRupiah(line.quantity * line.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total tagihan</p>
                  <p className="mt-1 text-base font-bold">{formatRupiah(detailWithLines.totalAmount)}</p>
                </div>
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Sudah dibayar</p>
                  <p className="mt-1 text-base font-bold text-primary">{formatRupiah(detailWithLines.settledAmount)}</p>
                </div>
                <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-destructive">Sisa pembayaran</p>
                  <p className="mt-1 text-base font-bold text-destructive">{formatRupiah(detailWithLines.remainingAmount)}</p>
                </div>
              </div>

              {detailWithLines.notes && <div className="rounded-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-xs"><p className="font-semibold text-primary">Catatan</p><p className="mt-0.5 text-muted-foreground">{detailWithLines.notes}</p></div>}

              {/* Revise.md §8 — commission panel attached to this invoice */}
              {detailWithLines.commission && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-primary">
                      Komisi Marketing · {detailWithLines.commission.partnerName} ({detailWithLines.commission.partnerPercent}%)
                    </span>
                    <StatusBadge status={detailWithLines.commission.status} />
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {formatRupiah(detailWithLines.commission.commissionAmount)} —{" "}
                    {detailWithLines.commission.status === "RELEASED"
                      ? "sudah dikredit ke wallet Marketing"
                      : "dirilis ke wallet hanya setelah invoice LUNAS penuh (§9)"}
                  </p>
                </div>
              )}

              {((detailWithLines as Invoice & { settlements?: { id: number; amount: number; method: string; settledAt: string }[] }).settlements?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-foreground">Riwayat Settlement</p>
                  <ul className="space-y-1 text-sm">
                    {((detailWithLines as Invoice & { settlements?: { id: number; amount: number; method: string; settledAt: string }[] }).settlements ?? []).map((s) => (
                      <li key={s.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5">
                        <span className="text-muted-foreground">
                          {formatDate(s.settledAt, true)} · {s.method}
                        </span>
                        <span className="font-semibold">{formatRupiah(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {printOpen && detailWithLines && "lines" in detailWithLines && <InvoicePrint invoice={detailWithLines as Invoice & { lines: InvoiceLine[] }} onClose={() => setPrintOpen(false)} />}

      {/* Settle dialog */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settle {detailWithLines?.invoiceNumber ?? ""}</DialogTitle>
            <DialogDescription>
              Sisa tagihan: {formatRupiah(detailWithLines?.remainingAmount ?? 0)}. Jumlah tidak boleh melebihi sisa.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSettle} className="space-y-4">
            <Field label="Jumlah (Rp)" htmlFor="st-amount">
              <NumberInput id="st-amount" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} required disabled={busy} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Metode" htmlFor="st-method">
                <FormSelect
                  value={settleMethod}
                  onValueChange={setSettleMethod}
                  options={[{ value: "TRANSFER", label: "Transfer" }, { value: "CASH", label: "Cash" }]}
                  disabled={busy}
                />
              </Field>
              <Field label="Referensi" htmlFor="st-ref">
                <Input id="st-ref" value={settleRef} onChange={(e) => setSettleRef(e.target.value)} placeholder="No. bukti transfer" disabled={busy} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSettleOpen(false)} disabled={busy}>
                Batal
              </Button>
              <SubmitButton busy={busy}>Catat Settlement</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus invoice {confirmDelete?.invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>Invoice yang sudah memiliki settlement tidak bisa dihapus.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
