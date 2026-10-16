// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { InvoicePrint } from "@/components/app/invoice-print";
import { ResiPrint } from "@/components/app/resi-print";
import { TransportManifestPrint } from "@/components/app/transport-manifest-print";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get, apiPost: vi.fn().mockResolvedValue({}) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, companyName: "Print QA" }) }));

// Optional HTML snapshots let Chromium verify the actual paged CSS without a database.
function exportFixture(name: string) {
  const dir = process.env.PRINT_QA_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), `<!doctype html><html><head><meta charset="utf-8"></head><body>${document.body.innerHTML}</body></html>`);
}
const invoice = {
  id: 1, invoiceNumber: "INV-PRINT-QA", customerName: "Customer", customerCode: "C-1", status: "SENT",
  totalAmount: 500_000, settledAmount: 0, remainingAmount: 500_000, discount: 0, rounding: 0,
  customerId: 1, customerCompanyName: "Customer", customerType: "b2b", issueDate: null, dueDate: null,
  linesCount: 1, lastPaidAt: null, isOverdue: false, createdAt: "2026-10-16",
  notes: "", settlements: [], lines: [{ id: 1, invoiceId: 1, description: "Pengiriman", quantity: 1, unitPrice: 500_000 }],
} satisfies ComponentProps<typeof InvoicePrint>["invoice"];

beforeEach(() => {
  m.get.mockReset().mockResolvedValue({ warehouses: [] });
});

describe("document and shipment print layouts", () => {
  it.each([[], undefined])("does not render a stray zero for an unpaid invoice with settlements %j", (settlements) => {
    render(<InvoicePrint invoice={{ ...invoice, settlements }} onClose={() => {}} />);
    const article = screen.getByRole("article");
    expect([...article.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())).toEqual([]);
    expect(article).toHaveClass("a4-sheet");
    expect(document.querySelector("[data-print-toolbar]")).toBeInTheDocument();
    exportFixture("invoice-short");
  });
  it("keeps all invoice rows in a flow that can span multiple A4 pages", () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ ...invoice.lines[0], id: i + 1, description: `INVOICE-ROW-${i + 1} - Pengiriman pelanggan`, unitPrice: 6250 }));
    render(<InvoicePrint invoice={{ ...invoice, lines }} onClose={() => {}} />);
    expect(screen.getAllByRole("row")).toHaveLength(81);
    exportFixture("invoice-long");
  });
  it.each([0, 1, 2, 3, 4])("prints the master and %i package labels individually on shipment label paper", async (count) => {
    const shipment = {
      id: 1, masterCode: "MASTER-PRINT-QA", origin: "Medan", destination: "Jakarta", createdAt: "2026-10-16",
      customer: { name: "Customer", companyName: "Customer", type: "b2b" }, priceAmount: 500_000, insuranceAmount: 5_000,
      details: Array.from({ length: count }, (_, i) => ({ id: i + 1, detailCode: `PACKAGE-${i + 1}`, description: `Package ${i + 1}`, actualWeightKg: 1 })),
    } as ComponentProps<typeof ResiPrint>["shipment"];
    render(<ResiPrint shipment={shipment} onClose={() => {}} />);
    expect(document.querySelectorAll(".resi-sheet")).toHaveLength(count + 1);
    expect(document.querySelectorAll(".a4-sheet")).toHaveLength(0);
    expect(screen.getByText(/100 × 100 mm/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".resi-sheet img")).toHaveAttribute("src", expect.stringMatching(/^data:image\/png/)));
    exportFixture(`resi-${count}`);
  });
  it.each([0, 80])("keeps a manifest with %i shipments in the shared A4 layout", async (count) => {
    m.get.mockResolvedValue({
      id: 1, transportCode: "MANIFEST-PRINT-QA", vehicle: { vehicleNumber: "BK 1234" }, status: "PLANNED",
      shipments: Array.from({ length: count }, (_, i) => ({ id: i + 1, masterCode: `MANIFEST-ROW-${i + 1}`, destination: "Jakarta", packages: 1, weightKg: 1, volumeM3: 0.01 })),
      shipmentCount: count, totalWeightKg: count, totalVolumeM3: count * 0.01,
    });
    render(<TransportManifestPrint transportId={1} onClose={() => {}} />);
    await screen.findByText("Manifest Transport / Surat Jalan");
    expect(document.querySelector(".manifest-sheet")).toHaveClass("a4-sheet");
    exportFixture(count ? "manifest-long" : "manifest-short");
  });
});
