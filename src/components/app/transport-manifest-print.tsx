"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { COMPANY_NAME } from "@/shared/company";
import {
    apiGet,
    apiPost,
    type TransportDetail,
    type TransportDropsBoard,
} from "@/infrastructure/http/client-api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

import { PrintPreview } from "@/components/app/print-preview";
import { TransportManifestTemplate } from "@/components/app/print-templates/TransportManifestTemplate";
import { printPaperDocument } from "@/presentation/print-document";

interface TransportManifestPrintProps {
    transportId: number | null;
    onClose: () => void;
}

/**
 * Transport Manifest — printable A4 summary of a transport: vehicle + crew,
 * capacity status (Capacity Round), route + schedule, and the shipment list
 * with per-shipment weight/volume/koli. Triggered from the transport
 * detail page's "Cetak Manifest" button.
 *
 * Opened on its own hash route, like InvoiceDetailPage, with a printable
 * portal and an A4 preview.
 */
export function TransportManifestPrint({
    transportId,
    onClose,
}: TransportManifestPrintProps) {
    const [printedAt] = useState(() => new Date());
    const { user, companyName } = useAuth();
    const displayCompanyName = companyName ?? COMPANY_NAME;
    const [transport, setTransport] = useState<TransportDetail | null>(null);
    const [transportMode, setTransportMode] = useState<
        TransportDropsBoard["transportMode"] | null
    >(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (transportId == null) {
            const t = setTimeout(() => {
                setTransport(null);
                setTransportMode(null);
                setReady(false);
            }, 0);
            return () => clearTimeout(t);
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            if (cancelled) return;
            setReady(false);
        }, 0);
        Promise.all([
            apiGet<TransportDetail>(`/transports/${transportId}`),
            apiGet<TransportDropsBoard>(
                `/transports/${transportId}/drops`,
            ).catch(() => null),
        ])
            .then(([t, drops]) => {
                if (cancelled) return;
                clearTimeout(timer);
                setTransport(t);
                setTransportMode(drops?.transportMode ?? null);
                setReady(true);
            })
            .catch(() => {
                if (cancelled) return;
                clearTimeout(timer);
                setReady(true);
            });
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [transportId]);

    useEffect(() => {
        if (!transport) return;
        const previousTitle = document.title;
        document.title = `Manifest ${transport.transportCode}`;
        return () => {
            document.title = previousTitle;
        };
    }, [transport]);

    if (transportId == null || typeof document === "undefined") return null;

    function doPrint() {
        // Fire-and-forget audit log (mirrors the resi print-log pattern) — logs
        // WHO printed the manifest and WHEN, for the audit trail.
        if (transport) {
            apiPost(`/transports/${transport.id}/print-log`, {}).catch(
                () => undefined,
            );
        }
        void printPaperDocument();
    }


    return createPortal(
        <>
            <div
                id="manifest-print-portal"
                data-print-portal
                className="fixed inset-0 z-[100] overflow-auto bg-neutral-200 p-4 dark:bg-neutral-900 print:bg-white print:p-0"
            >
                <div
                    data-print-toolbar
                    className="manifest-toolbar mx-auto mb-3 flex max-w-205 flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center print:hidden"
                >
                    <div>
                        <p className="text-sm font-semibold text-foreground">
                            Pratinjau Manifest Transport · A4 (210 × 297 mm)
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Skala 100%, margin sesuai dokumen, header/footer
                            browser nonaktif.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="sm"
                            onClick={doPrint}
                            disabled={!ready || !transport}
                        >
                            <Printer className="h-3.5 w-3.5" /> Cetak / Simpan
                            PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={onClose}>
                            <X className="h-3.5 w-3.5" /> Tutup
                        </Button>
                    </div>
                </div>

                <PrintPreview paper="a4">
                    <TransportManifestTemplate transport={transport} transportMode={transportMode} displayCompanyName={displayCompanyName} printedBy={user?.name ?? null} printedAt={printedAt} ready={ready} />
                </PrintPreview>

            </div>
        </>,
        document.body,
    );
}
