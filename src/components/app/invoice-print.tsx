"use client";

import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME, COMPANY_TAGLINE } from "@/lib/company";
import { type Invoice, type InvoiceLine } from "@/lib/client-api";
import { formatDate, formatNumber, formatRupiah } from "@/components/app/form-parts";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";

type PrintableInvoice = Invoice & {
  lines: InvoiceLine[];
  customer?: { companyName?: string | null; address?: string | null; email?: string | null; phone?: string | null };
};

export function InvoicePrint({ invoice, onClose }: { invoice: PrintableInvoice; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  const customer = invoice.customer;
  const companyName = customer?.companyName ?? invoice.customerName;
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  return createPortal(
    <div id="invoice-print-portal" className="fixed inset-0 z-[80] overflow-y-auto bg-neutral-200 dark:bg-neutral-900">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="text-sm font-bold text-foreground">Pratinjau Invoice</p><p className="truncate text-xs text-muted-foreground">{invoice.invoiceNumber} · siap dicetak atau disimpan sebagai PDF</p></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto"><Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onClose}><X className="h-4 w-4" /> Tutup</Button><Button type="button" className="flex-1 sm:flex-none" onClick={() => window.print()}><Printer className="h-4 w-4" /> Cetak / Simpan PDF</Button></div>
      </div>
      <article className="invoice-sheet mx-auto my-6 bg-white px-8 py-10 text-neutral-900 shadow-xl sm:px-12" aria-label={`Invoice ${invoice.invoiceNumber}`}>
        <header className="flex flex-col justify-between gap-8 border-b-2 border-neutral-900 pb-7 sm:flex-row">
          <div><p className="text-2xl font-black tracking-tight">{COMPANY_NAME}</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">{COMPANY_TAGLINE}</p></div>
          <div className="sm:text-right"><p className="text-3xl font-black tracking-tight text-emerald-700">INVOICE</p><p className="mt-1 font-mono text-sm font-bold">{invoice.invoiceNumber}</p><div className="mt-2 flex items-center gap-2 sm:justify-end"><StatusBadge status={invoice.status} />{invoice.isOverdue && <span className="text-[10px] font-bold text-red-600">TERLAMBAT</span>}</div></div>
        </header>
        <section className="grid gap-7 border-b py-7 text-sm sm:grid-cols-[1fr_1fr_160px]">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Ditagihkan kepada</p><p className="mt-2 font-bold">{companyName}</p><p className="font-mono text-xs text-neutral-500">{invoice.customerCode}</p>{customer?.address && <p className="mt-2 max-w-[250px] text-xs leading-relaxed text-neutral-600">{customer.address}</p>}{(customer?.email || customer?.phone) && <p className="mt-2 text-xs text-neutral-600">{customer.email ?? customer.phone}</p>}</div>
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Rincian tanggal</p><dl className="mt-2 space-y-1.5 text-xs"><div className="flex justify-between gap-4"><dt className="text-neutral-500">Tanggal terbit</dt><dd className="font-semibold">{formatDate(invoice.issueDate)}</dd></div><div className="flex justify-between gap-4"><dt className="text-neutral-500">Jatuh tempo</dt><dd className="font-semibold">{formatDate(invoice.dueDate)}</dd></div></dl></div>
          <div className="border-l border-neutral-200 pl-4 sm:text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Jumlah jatuh tempo</p><p className="mt-2 text-xl font-black">{formatRupiah(invoice.remainingAmount)}</p><p className="mt-1 text-[11px] text-neutral-500">dari {formatRupiah(invoice.totalAmount)}</p></div>
        </section>
        <section className="overflow-x-auto py-7"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b-2 border-neutral-900 text-left text-[10px] uppercase tracking-wider text-neutral-500"><th className="pb-3">Deskripsi</th><th className="w-16 pb-3 text-right">Qty</th><th className="w-32 pb-3 text-right">Harga satuan</th><th className="w-32 pb-3 text-right">Jumlah</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id} className="border-b border-neutral-200"><td className="py-3 pr-3"><p className="font-medium">{line.description}</p>{line.shipment?.masterCode && <p className="mt-0.5 font-mono text-[10px] text-neutral-500">Shipment {line.shipment.masterCode}</p>}</td><td className="py-3 text-right">{formatNumber(line.quantity)}</td><td className="py-3 text-right">{formatRupiah(line.unitPrice)}</td><td className="py-3 text-right font-semibold">{formatRupiah(line.quantity * line.unitPrice)}</td></tr>)}</tbody></table></section>
        <section className="ml-auto max-w-sm border-t-2 border-neutral-900 pt-4 text-sm"><div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span className="font-semibold">{formatRupiah(subtotal)}</span></div><div className="mt-2 flex justify-between"><span className="text-neutral-500">Sudah dibayar</span><span className="font-semibold text-emerald-700">- {formatRupiah(invoice.settledAmount)}</span></div><div className="mt-4 flex justify-between border-t border-neutral-200 pt-3 text-base"><span className="font-bold">Sisa pembayaran</span><span className="font-black text-emerald-700">{formatRupiah(invoice.remainingAmount)}</span></div></section>
        {(invoice.notes || invoice.settlements?.length) && <footer className="mt-12 grid gap-8 border-t pt-6 text-xs sm:grid-cols-2"><div>{invoice.notes && <><p className="font-bold uppercase tracking-wider text-neutral-500">Catatan</p><p className="mt-2 leading-relaxed text-neutral-600">{invoice.notes}</p></>}{invoice.settlements?.length ? <p className="mt-4 text-neutral-500">{invoice.settlements.length} pembayaran tercatat · terakhir {formatDate(invoice.settlements[0].settledAt, true)}</p> : null}</div><p className="self-end text-right text-neutral-500">Terima kasih atas kepercayaan Anda.</p></footer>}
      </article>
    </div>, document.body,
  );
}
