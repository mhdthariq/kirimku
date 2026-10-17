"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME, COMPANY_TAGLINE } from "@/shared/company";
import { useAuth } from "@/hooks/use-auth";
import {
    type Invoice,
    type InvoiceLine,
    apiPost,
} from "@/infrastructure/http/client-api";
import {
    formatDate,
    formatNumber,
    formatRupiah,
} from "@/components/app/form-parts";
import { InvoicePaymentAccount } from "@/components/app/invoice-payment-account";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";

type PrintableInvoice = Invoice & {
    lines: InvoiceLine[];
    customer?: {
        companyName?: string | null;
        address?: string | null;
        email?: string | null;
        phone?: string | null;
    };
};

export function InvoicePrint({
    invoice,
    onClose,
}: {
    invoice: PrintableInvoice;
    onClose: () => void;
}) {
    const { companyName: tenantCompanyName, user } = useAuth();
    const displayCompanyName = tenantCompanyName ?? COMPANY_NAME;

    // Build the "Dicetak oleh" label from the current session. Captured at
    // print time so the footer reflects whoever is actually logged in when
    // the user hits "Cetak / Simpan PDF" — not whoever opened the preview.
    // Format: "<Account Name> (<Role>)" using the user's display name and
    // the human-readable role name(s) attached to their account.
    const printByLabel = (() => {
        if (!user) return null;
        const accountName = user.name?.trim() || user.username;
        let roleLabel: string;
        if (user.isOwner) {
            roleLabel = "Owner";
        } else if (user.roles.length > 0) {
            roleLabel = user.roles.map((r) => r.name).join(" / ");
        } else {
            roleLabel = "-";
        }
        return `${accountName} (${roleLabel})`;
    })();

    // Fire-and-forget audit log — called right before window.print() opens
    // the OS print dialog. The server records who printed which invoice at
    // what time, so there's a permanent trail even if the PDF is deleted or
    // the printed copy is lost. Errors are swallowed on purpose: a failed
    // audit write must never block the actual print.
    const logPrint = () => {
        if (!invoice?.id) return;
        apiPost(`/invoices/${invoice.id}/print-log`).catch(() => undefined);
    };

    // Lock the page scroll behind the portal — exactly ONE scrollbar (the
    // portal's own) stays visible, even when opened from a long list page.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    if (typeof document === "undefined") return null;
    const customer = invoice.customer;
    const companyName = customer?.companyName ?? invoice.customerName;
    const subtotal = invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice,
        0,
    );

    return createPortal(
        <div
            id="invoice-print-portal"
            data-print-portal
            className="fixed inset-0 z-[80] overflow-auto bg-neutral-200 dark:bg-neutral-900"
        >
            <div
                data-print-toolbar
                className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between"
            >
                <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">
                        Pratinjau Invoice
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                        {invoice.invoiceNumber} · A4 (210 × 297 mm) · siap
                        dicetak atau disimpan sebagai PDF · skala 100%, margin
                        Tidak Ada, header/footer browser nonaktif
                    </p>
                    {printByLabel && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">
                                Akan dicetak oleh:
                            </span>{" "}
                            {printByLabel}
                        </p>
                    )}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <Button
                        type="button"
                        variant="outline"
                        className="flex-1 sm:flex-none"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" /> Tutup
                    </Button>
                    <Button
                        type="button"
                        className="flex-1 sm:flex-none"
                        onClick={() => {
                            logPrint();
                            window.print();
                        }}
                    >
                        <Printer className="h-4 w-4" /> Cetak / Simpan PDF
                    </Button>
                </div>
            </div>
            <article
                className="a4-sheet invoice-sheet mx-auto my-6 bg-white text-neutral-900 shadow-xl"
                aria-label={`Invoice ${invoice.invoiceNumber}`}
            >
                <header className="flex flex-row justify-between gap-8 border-b-2 border-neutral-900 pb-7">
                    <div>
                        <p className="text-2xl font-black tracking-tight">
                            {displayCompanyName}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">
                            {COMPANY_TAGLINE}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-3xl font-black tracking-tight text-emerald-700">
                            INVOICE
                        </p>
                        <p className="mt-1 font-mono text-sm font-bold">
                            {invoice.invoiceNumber}
                        </p>
                        <div className="mt-2 flex items-center justify-end gap-2">
                            <StatusBadge status={invoice.status} />
                            {invoice.isOverdue && (
                                <span className="text-[10px] font-bold text-red-600">
                                    TERLAMBAT
                                </span>
                            )}
                        </div>
                    </div>
                </header>
                <section className="invoice-parties grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px] gap-7 border-b py-7 text-sm">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            Ditagihkan kepada
                        </p>
                        <p className="mt-2 font-bold">{companyName}</p>
                        <p className="font-mono text-xs text-neutral-500">
                            {invoice.customerCode}
                        </p>
                        {customer?.address && (
                            <p className="mt-2 max-w-62.5 text-xs leading-relaxed text-neutral-600">
                                {customer.address}
                            </p>
                        )}
                        {(customer?.email || customer?.phone) && (
                            <p className="mt-2 text-xs text-neutral-600">
                                {customer.email ?? customer.phone}
                            </p>
                        )}
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            Rincian tanggal
                        </p>
                        <dl className="mt-2 space-y-1.5 text-xs">
                            <div className="flex justify-between gap-4">
                                <dt className="text-neutral-500">
                                    Tanggal terbit
                                </dt>
                                <dd className="font-semibold">
                                    {formatDate(invoice.issueDate)}
                                </dd>
                            </div>
                            <div className="flex justify-between gap-4">
                                <dt className="text-neutral-500">
                                    Jatuh tempo
                                </dt>
                                <dd className="font-semibold">
                                    {formatDate(invoice.dueDate)}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div className="border-l border-neutral-200 pl-4 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            Jumlah jatuh tempo
                        </p>
                        <p className="mt-2 text-xl font-black">
                            {formatRupiah(invoice.remainingAmount)}
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-500">
                            dari {formatRupiah(invoice.totalAmount)}
                        </p>
                    </div>
                </section>
                <section className="invoice-items py-7">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b-2 border-neutral-900 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                                <th className="pb-3">Deskripsi</th>
                                <th className="w-16 pb-3 text-right">Qty</th>
                                <th className="w-32 pb-3 text-right">
                                    Harga satuan
                                </th>
                                <th className="w-32 pb-3 text-right">Jumlah</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoice.lines.map((line) => (
                                <tr
                                    key={line.id}
                                    className="border-b border-neutral-200"
                                >
                                    <td className="py-3 pr-3">
                                        <p className="font-medium">
                                            {line.description}
                                        </p>
                                        {line.shipment?.masterCode && (
                                            <p className="mt-0.5 font-mono text-[10px] text-neutral-500">
                                                Shipment{" "}
                                                {line.shipment.masterCode}
                                            </p>
                                        )}
                                    </td>
                                    <td className="py-3 text-right">
                                        {formatNumber(line.quantity)}
                                    </td>
                                    <td className="py-3 text-right">
                                        {formatRupiah(line.unitPrice)}
                                    </td>
                                    <td className="py-3 text-right font-semibold">
                                        {formatRupiah(
                                            line.quantity * line.unitPrice,
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
                <section
                    className="invoice-summary grid grid-cols-2 items-start gap-8 border-t-2 border-neutral-900 pt-4"
                    aria-label="Ringkasan pembayaran"
                >
                    <div className="min-w-0">
                        <InvoicePaymentAccount invoice={invoice} />
                    </div>
                    <div className="min-w-0">
                        <section
                            className="invoice-totals text-sm"
                            aria-label="Total invoice"
                        >
                            <div className="flex justify-between">
                                <span className="text-neutral-500">
                                    Subtotal
                                </span>
                                <span className="font-semibold">
                                    {formatRupiah(subtotal)}
                                </span>
                            </div>
                            <div className="mt-2 flex justify-between">
                                <span className="text-neutral-500">Diskon</span>
                                <span className="font-semibold">
                                    - {formatRupiah(invoice.discount)}
                                </span>
                            </div>
                            <div className="mt-2 flex justify-between">
                                <span className="text-neutral-500">
                                    Pembulatan
                                </span>
                                <span className="font-semibold">
                                    {invoice.rounding >= 0 ? "+ " : "- "}
                                    {formatRupiah(Math.abs(invoice.rounding))}
                                </span>
                            </div>
                            <div className="mt-2 flex justify-between border-t border-neutral-200 pt-2">
                                <span className="font-bold">Total</span>
                                <span className="font-bold">
                                    {formatRupiah(invoice.totalAmount)}
                                </span>
                            </div>
                            <div className="mt-2 flex justify-between">
                                <span className="text-neutral-500">
                                    Sudah dibayar
                                </span>
                                <span className="font-semibold text-emerald-700">
                                    - {formatRupiah(invoice.settledAmount)}
                                </span>
                            </div>
                            <div className="mt-4 flex justify-between border-t border-neutral-200 pt-3 text-base">
                                <span className="font-bold">
                                    Sisa pembayaran
                                </span>
                                <span className="font-black text-emerald-700">
                                    {formatRupiah(invoice.remainingAmount)}
                                </span>
                            </div>
                        </section>
                        <p className="ml-auto mt-3 max-w-sm text-xs text-neutral-600">
                            PPh (termasuk pembayaran):{" "}
                            <b>
                                {formatRupiah(
                                    invoice.pphAmount ??
                                        invoice.settlements?.reduce(
                                            (sum, s) => sum + s.pph,
                                            0,
                                        ) ??
                                        0,
                                )}
                            </b>
                        </p>
                    </div>
                </section>
                {(Boolean(invoice.notes) ||
                    (invoice.settlements?.length ?? 0) > 0) && (
                    <section className="invoice-notes mt-8 grid grid-cols-2 gap-8 border-t pt-6 text-xs">
                        <div>
                            {invoice.notes && (
                                <>
                                    <p className="font-bold uppercase tracking-wider text-neutral-500">
                                        Catatan
                                    </p>
                                    <p className="mt-2 leading-relaxed text-neutral-600">
                                        {invoice.notes}
                                    </p>
                                </>
                            )}
                            {invoice.settlements?.length ? (
                                <p className="mt-4 text-neutral-500">
                                    {invoice.settlements.length} pembayaran
                                    tercatat · terakhir{" "}
                                    {formatDate(
                                        invoice.settlements[0].settledAt,
                                        true,
                                    )}
                                </p>
                            ) : null}
                        </div>
                        <p className="self-end text-right text-neutral-500">
                            Terima kasih atas kepercayaan Anda.
                        </p>
                    </section>
                )}
                <footer
                    className="invoice-print-footer border-t border-neutral-200 pt-3 text-[10px] leading-relaxed text-neutral-500"
                    aria-label="Informasi cetak invoice"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <span>
                                <span className="font-bold uppercase tracking-wider text-neutral-600">
                                    Dicetak:
                                </span>{" "}
                                {new Date().toLocaleString("id-ID")}
                            </span>
                            {printByLabel && (
                                <span className="block">
                                    <span className="font-bold uppercase tracking-wider text-neutral-600">
                                        Dicetak oleh:
                                    </span>{" "}
                                    {printByLabel}
                                </span>
                            )}
                        </div>
                        <div className="text-right text-[9px] text-neutral-400">
                            <p className="font-mono">{invoice.invoiceNumber}</p>
                            <p>Dokumen ini dicetak dari sistem NovaLogistik.</p>
                        </div>
                    </div>
                </footer>
            </article>
        </div>,
        document.body,
    );
}
