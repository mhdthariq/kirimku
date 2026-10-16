// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, InvoiceLine } from "@/infrastructure/http/client-api";

const m = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), remove: vi.fn(), permissions: [] as string[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, companyName: "Test Company" }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(),
  apiGet: m.get, apiPut: m.put, apiDelete: m.remove,
  hasPermission: (_user: unknown, permission: string) => m.permissions.includes(permission),
}));
vi.mock("@/components/app/data-table", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  DataTable: ({ rows, columns }: { rows: Invoice[]; columns: { key: string; render: (row: Invoice) => React.ReactNode }[] }) => <table><tbody>{rows.map((row) => <tr key={row.id}>{columns.map((col) => <td key={col.key}>{col.render(row)}</td>)}</tr>)}</tbody></table>,
}));
vi.mock("@/components/app/activity-log-panel", () => ({ ActivityLogPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InvoicesPage } from "@/components/app/pages/invoices-page";
import { InvoicePrint } from "@/components/app/invoice-print";

const invoice = {
  id: 1, invoiceNumber: "INV-1", customerName: "Customer", customerCompanyName: "Customer", customerCode: "C-1", status: "SETTLED",
  totalAmount: 500_000, settledAmount: 500_000, remainingAmount: 0, pphAmount: 5_000, discount: 0, rounding: 0,
  lines: [{ id: 1, description: "Shipment", quantity: 1, unitPrice: 500_000 }],
  settlements: [{ id: 10, invoiceId: 1, amount: 500_000, pph: 5_000, method: "TRANSFER", reference: "REF", settledAt: "2026-10-16T00:00:00.000Z", proofUrl: "data:application/pdf;base64,AAAA" }],
} as Invoice & { lines: InvoiceLine[] };
beforeEach(() => {
  vi.clearAllMocks();
  m.permissions = ["invoice.view", "invoice.settlement.update", "invoice.settlement.delete"];
  m.get.mockImplementation(async (path: string) => path === "/invoices" ? [invoice] : path === "/invoices/1" ? invoice : path.startsWith("/bank-accounts") ? [] : {});
  m.put.mockResolvedValue({});
  m.remove.mockResolvedValue({});
});

describe("invoice history and print", () => {
  it("shows PPh on print while preserving the full paid amount and zero remaining", () => {
    render(<InvoicePrint invoice={invoice} onClose={() => {}} />);
    const sheet = screen.getByRole("article");
    expect(within(sheet).getByText("PPh (termasuk pembayaran):").parentElement).toHaveTextContent("5.000");
    expect(within(sheet).getByText("Sudah dibayar").parentElement).toHaveTextContent("500.000");
    expect(within(sheet).getByText("Sisa pembayaran").parentElement).toHaveTextContent("Rp0");
  });
  it("opens history from the eye button and saves PPh edits without losing proof", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "Lihat riwayat INV-1" }));
    await user.click(await screen.findByRole("button", { name: /^Edit$/ }));
    expect(screen.getByLabelText("Jumlah Transfer / Cash (Rp)")).toHaveValue(500000);
    fireEvent.change(screen.getByLabelText("PPh (Rp)"), { target: { value: "10000" } });
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith("/invoices/1/settlements/10", expect.objectContaining({ amount: 500_000, pph: 10_000, settledAt: invoice.settlements![0].settledAt, proofUrl: invoice.settlements![0].proofUrl })));
  });
  it("requires confirmation before deleting from history", async () => {
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "Lihat riwayat INV-1" }));
    await user.click(await screen.findByRole("button", { name: /^Hapus$/ }));
    expect(m.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ya, hapus settlement" }));
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("/invoices/1/settlements/10"));
  });
  it("hides history edit/delete controls without the new permissions", async () => {
    m.permissions = ["invoice.view", "invoice.update", "payment.verify"];
    const user = userEvent.setup();
    render(<InvoicesPage />);
    await user.click(await screen.findByRole("button", { name: "Lihat riwayat INV-1" }));
    await screen.findByText("Riwayat Settlement");
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hapus$/ })).not.toBeInTheDocument();
  });
});
