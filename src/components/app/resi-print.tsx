"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer, X } from "lucide-react";
import { apiGet, apiPost, type Options } from "@/infrastructure/http/client-api";
import { ResiTemplate, type ResiShipment } from "@/components/app/print-templates/ResiTemplate";
import { printPaperDocument } from "@/presentation/print-document";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { PrintPreview } from "@/components/app/print-preview";
interface ResiPrintProps {
    shipment: ResiShipment | null;
    onClose: () => void;
}

/**
 * Build the "Dicetak oleh" label from the current session.
 *
 * Format: "<Account Name> (<Role1> / <Role2>)"
 * - Uses the user's display `name` (Account Name) — not the username — so
 *   the printed footer matches what staff see in the header/sidebar.
 * - Owner gets the literal "Owner" role; non-owner users list every role
 *   `name` attached to their account, joined by ` / ` for multi-role cases.
 * - Returns null when there is no session (e.g. deep-link opened before
 *   login completes) so the print layout never shows an empty "()" pair.
 */
function buildPrintByLabel(
    user: ReturnType<typeof useAuth>["user"],
): string | null {
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
}

/** Shipment resi and package labels print on separate 100 × 100 mm pages. */
export function ResiPrint({ shipment, onClose }: ResiPrintProps) {
    const [printedAt] = useState(() => new Date());
    const { user } = useAuth();
    const [qrMap, setQrMap] = useState<Record<string, string>>({});
    const [options, setOptions] = useState<Options | null>(null);

    // Print-by label — resolved once per render from the session. Captured at
    // print time (not at component mount) so the footer reflects whoever is
    // actually logged in when the user hits "Cetak / Simpan PDF".
    const printByLabel = buildPrintByLabel(user);

    // Fire-and-forget audit log — called right before window.print() opens
    // the OS print dialog. The server records who printed which resi at
    // what time, so there's a permanent trail even if the printed paper
    // copy is lost or the PDF is deleted. Errors are swallowed on purpose:
    // a failed audit write must never block the actual print.
    const logPrint = () => {
        if (!shipment?.id) return;
        apiPost(`/shipments/${shipment.id}/print-log`).catch(() => undefined);
    };

    // Lock the page scroll behind the portal — exactly ONE scrollbar (the
    // portal's own) stays visible, matching the invoice detail print view.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    useEffect(() => {
        apiGet<Options>("/options")
            .then(setOptions)
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!shipment) return;

        let cancelled = false;

        const codes = [
            shipment.resi ?? shipment.masterCode,
            ...shipment.details.map((d) => d.detailCode),
        ].filter(Boolean);

        Promise.all(
            codes.map(async (code) => {
                // Higher width + margin: gives the QR more quiet zone so a
                // thermal-printed copy scans even if the surrounding ink bleeds.
                const url = await QRCode.toDataURL(code, {
                    margin: 2,
                    width: 480,
                    errorCorrectionLevel: "M",
                    color: {
                        dark: "#000000",
                        light: "#ffffff",
                    },
                });

                return [code, url] as const;
            }),
        )
            .then((entries) => {
                if (!cancelled) {
                    setQrMap(Object.fromEntries(entries));
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [shipment]);

    if (!shipment || typeof document === "undefined") {
        return null;
    }

    const resiNumber = shipment.resi ?? shipment.masterCode;
    const totalPackages = shipment.details.length;

    return createPortal(
        <>
            <div
                id="resi-print-portal"
                data-print-portal
                className="fixed inset-0 z-80 overflow-y-auto bg-neutral-200 dark:bg-neutral-900"
            >
                {/* Screen toolbar */}
                <div
                    data-print-toolbar
                    className="print-toolbar sticky top-0 z-10 flex flex-col gap-3 border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-800 sm:flex-row sm:items-center sm:justify-between"
                >
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">
                            Pratinjau Cetak Resi - {resiNumber}
                        </p>

                        <p className="text-xs text-muted-foreground">
                            100 × 100 mm • 1 label per halaman • 1 Master Resi +{" "}
                            {totalPackages} Package Label
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
                            <X className="h-4 w-4" />
                            Tutup
                        </Button>

                        <Button
                            type="button"
                            className="flex-1 sm:flex-none"
                            onClick={() => {
                                logPrint();
                                void printPaperDocument();
                            }}
                        >
                            <Printer className="h-4 w-4" />
                            Cetak / Simpan PDF
                        </Button>
                    </div>
                </div>

                {/* Preview */}
                <div className="print-content px-2 py-4 print:p-0">
                    <PrintPreview paper="label"><ResiTemplate shipment={shipment} options={options} qrMap={qrMap} printByLabel={printByLabel} printedAt={printedAt} /></PrintPreview>
                </div>
            </div>
        </>,
        document.body,
    );
}
