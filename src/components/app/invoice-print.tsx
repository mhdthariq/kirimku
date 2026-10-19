"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/shared/company";
import { useAuth } from "@/hooks/use-auth";
import {
    apiPost,
} from "@/infrastructure/http/client-api";
import { Button } from "@/components/ui/button";
import { InvoiceTemplate, type PrintableInvoice } from "@/components/app/print-templates/InvoiceTemplate";
import { printPaperDocument } from "@/presentation/print-document";
import { PrintPreview } from "@/components/app/print-preview";


export function InvoicePrint({
    invoice,
    onClose,
}: {
    invoice: PrintableInvoice;
    onClose: () => void;
}) {
    const [printedAt] = useState(() => new Date());
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
                    <p className="text-xs text-muted-foreground">
                        {invoice.invoiceNumber} · A4 (210 × 297 mm) · siap
                        dicetak atau disimpan sebagai PDF · skala 100%, margin
                        sesuai dokumen, header/footer browser nonaktif
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
                            void printPaperDocument();
                        }}
                    >
                        <Printer className="h-4 w-4" /> Cetak / Simpan PDF
                    </Button>
                </div>
            </div>
            <PrintPreview paper="a4">
                <InvoiceTemplate invoice={invoice} displayCompanyName={displayCompanyName} printByLabel={printByLabel} printedAt={printedAt} />
            </PrintPreview>
        </div>,
        document.body,
    );
}
