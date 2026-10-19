// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { InvoicePrint } from "@/components/app/invoice-print";
import { ResiPrint } from "@/components/app/resi-print";
import { TransportManifestPrint } from "@/components/app/transport-manifest-print";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({
    apiGet: m.get,
    apiPost: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/hooks/use-auth", () => ({
    useAuth: () => ({ user: null, companyName: "Print QA" }),
}));

// Optional HTML snapshots let Chromium verify the actual paged CSS without a database.
function exportFixture(name: string) {
    const dir = process.env.PRINT_QA_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, `${name}.html`),
        `<!doctype html><html><head><meta charset="utf-8"></head><body>${document.body.innerHTML}</body></html>`,
    );
}
const invoice = {
    id: 1,
    invoiceNumber: "INV-PRINT-QA",
    customerName: "Customer",
    customerCode: "C-1",
    status: "SENT",
    totalAmount: 500_000,
    settledAmount: 0,
    remainingAmount: 500_000,
    discount: 0,
    rounding: 0,
    customerId: 1,
    customerCompanyName: "Customer",
    customerType: "b2b",
    issueDate: null,
    dueDate: null,
    linesCount: 1,
    lastPaidAt: null,
    isOverdue: false,
    createdAt: "2026-10-16",
    notes: "",
    settlements: [],
    lines: [
        {
            id: 1,
            invoiceId: 1,
            description: "Pengiriman",
            quantity: 1,
            unitPrice: 500_000,
        },
    ],
} satisfies ComponentProps<typeof InvoicePrint>["invoice"];

beforeEach(() => {
    m.get.mockReset().mockResolvedValue({ warehouses: [] });
});

describe("document and shipment print layouts", () => {
    it("keeps A4 geometry identical in preview and print", () => {
        const css = readFileSync("src/app/globals.css", "utf8");
        const printCss = css.slice(css.indexOf("@media print"));
        const sheet = printCss.match(/\.a4-sheet\s*\{([^}]+)\}/)?.[1];
        expect(printCss).toMatch(/@page\s*\{\s*size: A4 portrait;\s*margin: 0;/);
        expect(sheet).toContain("width: 210mm !important;");
        expect(sheet).toContain("height: 297mm !important;");
        expect(sheet).toContain("padding: 12mm !important;");
        expect(printCss).not.toMatch(/\.invoice-sheet\s*\{[^}]*display: block/);
        expect(printCss).not.toMatch(/\.manifest-print-footer\s*\{[^}]*position: fixed/);
        expect(printCss).toContain("transform: none !important;");
        expect(printCss).toContain("height: 99.5mm !important;");
        expect(printCss).toMatch(/@page shipment-label\s*\{\s*size: 100mm 100mm;\s*margin: 0;/);
    });

    it("uses the same invoice columns and table layout at every preview width", () => {
        render(
            <InvoicePrint
                invoice={{ ...invoice, notes: "Catatan pengiriman" }}
                onClose={() => {}}
            />,
        );
        const article = screen.getByRole("article");
        expect(article.querySelector("header")).toHaveClass("flex-row");
        expect(article.querySelector(".invoice-parties")).toHaveClass(
            "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]",
        );
        expect(article.querySelector(".invoice-summary")).toHaveClass(
            "grid-cols-2",
        );
        expect(article.querySelector(".invoice-notes")).toHaveClass(
            "grid-cols-2",
        );
        expect(article.querySelector(".invoice-items")).not.toHaveClass(
            "overflow-x-auto",
        );
        expect(article.querySelector("table")).not.toHaveClass("min-w-130");
        expect(article.querySelector("footer")).toHaveTextContent(
            "INV-PRINT-QA",
        );
    });

    it.each([[], undefined])(
        "does not render a stray zero for an unpaid invoice with settlements %j",
        (settlements) => {
            render(
                <InvoicePrint
                    invoice={{ ...invoice, settlements }}
                    onClose={() => {}}
                />,
            );
            const article = screen.getByRole("article");
            expect(
                [...article.childNodes].filter(
                    (node) =>
                        node.nodeType === Node.TEXT_NODE &&
                        node.textContent?.trim(),
                ),
            ).toEqual([]);
            expect(article).toHaveClass("a4-sheet");
            expect(article.closest(".paper-preview")).toHaveAttribute(
                "data-paper",
                "a4",
            );
            expect(
                document.querySelector("[data-print-toolbar]"),
            ).toBeInTheDocument();
            exportFixture("invoice-short");
        },
    );
    it("keeps all invoice rows in a flow that can span multiple A4 pages", () => {
        const lines = Array.from({ length: 80 }, (_, i) => ({
            ...invoice.lines[0],
            id: i + 1,
            description: `INVOICE-ROW-${i + 1} - Pengiriman pelanggan`,
            unitPrice: 6250,
        }));
        render(
            <InvoicePrint invoice={{ ...invoice, lines }} onClose={() => {}} />,
        );
        expect(screen.getAllByRole("row")).toHaveLength(81);
        exportFixture("invoice-long");
    });
    it.each([0, 1, 2, 3, 4])(
        "prints the master and %i package labels individually on shipment label paper",
        async (count) => {
            const shipment = {
                id: 1,
                masterCode: "MASTER-PRINT-QA",
                origin: "Medan",
                destination: "Jakarta",
                createdAt: "2026-10-16",
                customer: {
                    name: "Customer",
                    companyName: "Customer",
                    type: "b2b",
                },
                priceAmount: 500_000,
                insuranceAmount: 5_000,
                details: Array.from({ length: count }, (_, i) => ({
                    id: i + 1,
                    detailCode: `PACKAGE-${i + 1}`,
                    description: `Package ${i + 1}`,
                    actualWeightKg: 1,
                })),
            } as ComponentProps<typeof ResiPrint>["shipment"];
            render(<ResiPrint shipment={shipment} onClose={() => {}} />);
            expect(document.querySelectorAll(".resi-sheet")).toHaveLength(
                count + 1,
            );
            expect(document.querySelectorAll(".a4-sheet")).toHaveLength(0);
            expect(
                document.querySelector('.paper-preview[data-paper="label"]'),
            ).toBeInTheDocument();
            expect(
                document.querySelector('style[media="print"]'),
            ).toHaveTextContent("@page { size: 100mm 100mm; margin: 0; }");
            expect(screen.getByText(/100 × 100 mm/)).toBeInTheDocument();
            await waitFor(() =>
                expect(
                    document.querySelector(".resi-sheet img"),
                ).toHaveAttribute(
                    "src",
                    expect.stringMatching(/^data:image\/png/),
                ),
            );
            exportFixture(`resi-${count}`);
        },
    );
    it.each([0, 80])(
        "keeps a manifest with %i shipments in the shared A4 layout",
        async (count) => {
            m.get.mockResolvedValue({
                id: 1,
                transportCode: "MANIFEST-PRINT-QA",
                vehicle: { vehicleNumber: "BK 1234" },
                status: "PLANNED",
                shipments: Array.from({ length: count }, (_, i) => ({
                    id: i + 1,
                    masterCode: `MANIFEST-ROW-${i + 1}`,
                    destination: "Jakarta",
                    packages: 1,
                    weightKg: 1,
                    volumeM3: 0.01,
                })),
                shipmentCount: count,
                totalWeightKg: count,
                totalVolumeM3: count * 0.01,
            });
            render(
                <TransportManifestPrint transportId={1} onClose={() => {}} />,
            );
            await screen.findByText("Manifest Transport / Surat Jalan");
            expect(document.querySelector(".manifest-sheet")).toHaveClass(
                "a4-sheet",
            );
            exportFixture(count ? "manifest-long" : "manifest-short");
        },
    );
});
