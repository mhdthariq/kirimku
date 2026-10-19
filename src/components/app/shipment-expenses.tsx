"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { runAction, useApiData } from "@/hooks/use-api-data";
import { apiDelete, apiGet, apiPost, hasPermission, type OperationalExpenseRecord } from "@/infrastructure/http/client-api";
import { EXPENSE_LABEL, EXPENSE_TYPES, validateExpense } from "@/domain/transport-ops";
import { expenseProgress } from "@/domain/expense-progress";
import { ExpenseReportRows } from "@/components/app/operational-expense-report";
import { DashboardError } from "@/components/app/dashboard-ui";
import { Field, FormSelect, Input, NumberInput, SubmitButton, formatRupiah } from "@/components/app/form-parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ShipmentExpenses({ shipmentId }: { shipmentId: number }) {
  const { user } = useAuth();
  const path = `/shipments/${shipmentId}/operational-expenses`;
  const { data, error, reload } = useApiData<{ rows: OperationalExpenseRecord[]; canCreate: boolean }>(() => apiGet(path), [shipmentId]);
  const [type, setType] = useState("BONGKAR");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ row: OperationalExpenseRecord; action: "cancel" | "remove" } | null>(null);
  const [reason, setReason] = useState("");
  const approve = hasPermission(user, "transport.expense.approve");
  const progress = expenseProgress(data?.rows ?? []);
  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    try { const saved = await runAction(action, { success }); if (saved) await reload(); return saved; }
    finally { setBusy(false); }
  }
  if (error) return <DashboardError message={error} onRetry={() => { void reload(); }} />;
  return <section className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-6" aria-label="Biaya shipment">
    <h2 className="text-base font-semibold">Biaya Shipment B2B</h2>
    <p className="text-xs text-muted-foreground">Biaya khusus shipment, terpisah dari harga customer dan biaya transport. Admin Gudang menginput setelah konfirmasi tiba di gudang untuk shipment non-Marketing.</p>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><div className="min-w-0 rounded-xl bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">Biaya diajukan</dt><dd className="break-all text-lg font-semibold">{formatRupiah(progress.submitted)}</dd></div><div className="min-w-0 rounded-xl bg-muted/30 p-3"><dt className="text-xs text-muted-foreground">Approve ({progress.percentage}%)</dt><dd className="break-all text-lg font-semibold">{formatRupiah(progress.approved)}</dd></div></dl>
    {data?.canCreate && <form className="grid min-w-0 items-end gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); if (validateExpense({ type, amount })) return;
      if (await act(() => apiPost(path, { type, amount: Number(amount), description }), "Biaya shipment ditambahkan; menunggu approval.")) { setAmount(""); setDescription(""); }
    }}>
      <Field label="Jenis biaya"><FormSelect value={type} onValueChange={setType} options={EXPENSE_TYPES.map(value => ({ value, label: EXPENSE_LABEL[value] }))} disabled={busy} /></Field>
      <Field label="Nominal (Rp)"><NumberInput aria-label="Nominal biaya shipment" value={amount} min={1} step="any" required disabled={busy} onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="Keterangan (opsional)"><Input value={description} maxLength={1000} disabled={busy} onChange={event => setDescription(event.target.value)} /></Field>
      <SubmitButton busy={busy}>Tambah Biaya Shipment</SubmitButton>
    </form>}
    {!data ? <p role="status">Memuat biaya…</p> : data.rows.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada biaya shipment.</p> : data.rows.map(row => <div key={row.id} className="min-w-0 space-y-2">
      <ExpenseReportRows rows={[row]} />
      <div className="flex flex-wrap gap-2">
        {approve && row.status === "PENDING" && <Button size="sm" disabled={busy} onClick={() => act(() => apiPost(`${path}/${row.id}`, { action: "approve" }), "Biaya disetujui.")}>Approve {formatRupiah(row.amount)}</Button>}
        {approve && row.status === "APPROVED" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setReason(""); setDialog({ row, action: "cancel" }); }}>Batalkan approval</Button>}
        {((approve && ["APPROVED", "CANCELLED"].includes(row.status)) || (row.status === "PENDING" && hasPermission(user, "transport.expense.delete"))) && <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setReason(""); setDialog({ row, action: "remove" }); }}>Hapus biaya</Button>}
      </div>
    </div>)}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>{dialog?.action === "cancel" ? "Batalkan approval" : "Hapus biaya"}</DialogTitle><DialogDescription>{dialog?.row.expenseCode} · Alasan tersimpan di log audit. Biaya yang dibatalkan tetap terlihat sebagai Cancelled.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (!dialog || !reason.trim()) return;
        const url = `${path}/${dialog.row.id}`;
        if (await act(() => dialog.action === "cancel" ? apiPost(url, { action: "cancel", reason }) : apiDelete(url, { reason }), "Biaya diperbarui.")) setDialog(null);
      }}><Field label="Alasan (wajib)"><Input aria-label="Alasan perubahan biaya" value={reason} required maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} /></Field><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Kembali</Button><SubmitButton busy={busy} disabled={!reason.trim()}>Konfirmasi</SubmitButton></DialogFooter></form>
    </DialogContent></Dialog>
  </section>;
}

export function UndoShipmentArrival({ shipmentId, onChanged }: { shipmentId: number; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <><Button variant="outline" onClick={() => { setReason(""); setOpen(true); }}>Undo tiba di gudang</Button><Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>Undo tiba di gudang</DialogTitle><DialogDescription>Penerimaan gudang dibatalkan dan paket perlu dikonfirmasi ulang. Proses lanjutan dan biaya aktif harus dibatalkan terlebih dahulu.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (busy || !reason.trim()) return; setBusy(true);
    try { if (await runAction(() => apiPost(`/shipments/${shipmentId}/undo-arrival`, { reason }), { success: "Penerimaan gudang dibatalkan." })) { setOpen(false); await onChanged(); } }
    finally { setBusy(false); }
  }}><Field label="Alasan (wajib)"><Input aria-label="Alasan undo penerimaan" required maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></Field><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Kembali</Button><SubmitButton busy={busy} disabled={!reason.trim()}>Undo penerimaan</SubmitButton></DialogFooter></form></DialogContent></Dialog></>;
}
