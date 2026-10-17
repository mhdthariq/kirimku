// @vitest-environment jsdom
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { TransportDetail } from "@/infrastructure/http/client-api";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn(), owner: true, permissions: [] as string[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Andi", isOwner: m.owner, employeeId: null, roles: [{ slug: "owner" }], permissions: m.permissions }, companyName: "KirimKu" }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get, apiPost: m.post, apiPut: m.put, apiDelete: m.remove, hasPermission: (_: unknown, permission: string) => m.owner || m.permissions.includes(permission) }));
vi.mock("next/dynamic", () => ({ default: () => () => <div className="h-64 w-full rounded-xl bg-muted" aria-label="Peta transport" /> }));
vi.mock("@/components/app/transport-form-dialog", () => ({ TransportFormDialog: () => null }));
vi.mock("@/components/app/checkpoint-checkin-dialog", () => ({ CheckpointCheckinDialog: () => null }));
vi.mock("@/components/app/activity-log-panel", () => ({ ActivityLogPanel: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { BankAccountsPage } from "@/components/app/pages/bank-accounts-page";
import { OperationalExpensesPage } from "@/components/app/pages/operational-expenses-page";
import { ShipmentTransportExpenses } from "@/components/app/operational-expense-report";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";
import { InvoicesPage } from "@/components/app/pages/invoices-page";
import { InvoicePrint } from "@/components/app/invoice-print";

const bank = { id: 1, bankName: "BCA", accountNumber: "001234567890", accountName: "PT KirimKu Logistik Indonesia", isActive: true };
const date = "2026-10-16T10:00:00Z";
const rows = [{ id: 1, expenseCode: "EXP-2026-000001", type: "ANGKUT", amount: 500_000, description: "Biaya angkut muatan dari Medan ke Jakarta", status: "APPROVED", createdAt: date, transport: { id: 10, transportCode: "TR-2026-000010", origin: "Medan", destination: "Jakarta" } }, { id: 2, expenseCode: "EXP-2026-000002", type: "BBM", amount: 9_999_999_999, description: "Pengisian BBM", status: "PENDING", createdAt: date, transport: { id: 10, transportCode: "TR-2026-000010", origin: "Medan", destination: "Jakarta" } }];
const expenseReport = { approvedTotal: 500_000, pendingTotal: 9_999_999_999, byType: ["BONGKAR", "PARKIR", "MAKAN", "BBM", "ANGKUT"].map(type => ({ type, label: { BONGKAR: "Biaya Bongkar", PARKIR: "Biaya Parkir", MAKAN: "Uang Makan", BBM: "Biaya BBM", ANGKUT: "Biaya Angkut" }[type], approved: type === "ANGKUT" ? 500_000 : 0, pending: type === "BBM" ? 9_999_999_999 : 0, count: type === "BBM" || type === "ANGKUT" ? 1 : 0 })), rows, count: 2, pages: 1, page: 1, pageSize: 25 };
const transport = {
  id: 10, transportCode: "TR-2026-000010", trackingMode: "CHECKPOINT", transportMode: "DIRECT", status: "DEPARTED", origin: "Medan", destination: "Jakarta", routeName: "Medan - Jakarta via Palembang",
  vehicle: { id: 1, vehicleNumber: "BK 1234 ABC", name: "Truck Box Armada Utama" }, driver: { id: 2, name: "Muhammad Andi Pratama" }, kenek: { id: 3, name: "Agus" },
  plannedDepartureAt: date, plannedArrivalAt: date, departedAt: date, arrivedAt: null, currentLatitude: null, currentLongitude: null,
  checkpoints: [{ id: 1, name: "Gudang Medan", sequence: 1, latitude: 3.59, longitude: 98.67, radiusMeters: 500 }, { id: 2, name: "Gudang Jakarta", sequence: 2, latitude: -6.2, longitude: 106.8, radiusMeters: 500 }], checkpointRecords: [],
  shipments: [{ id: 1, masterCode: "MS-2026-000001", customerName: "PT Nusantara Logistik Internasional Cabang Medan", penerimaName: "PT Mitra Jakarta", destination: "Jakarta", status: "IN_TRANSPORT", packages: 12, weightKg: 250, volumeM3: 2.5, priceAmount: 9_999_999_999 }], shipmentCount: 1, totalWeightKg: 250, totalVolumeM3: 2.5, totalPrice: 9_999_999_999, totalKoli: 12,
} as unknown as TransportDetail;
const invoice = { id: 1, invoiceNumber: "INV-PRINT-BANK", customerName: "Customer", customerCode: "C-1", customerCompanyName: "Customer", customerType: "b2b", status: "DRAFT", customerId: 1, discount: 0, rounding: 0, notes: "", settlements: [], totalAmount: 500_000, settledAmount: 0, remainingAmount: 500_000, paymentBankName: bank.bankName, paymentAccountNumber: bank.accountNumber, paymentAccountName: bank.accountName, lines: [{ id: 1, invoiceId: 1, description: "Pengiriman", quantity: 1, unitPrice: 500_000 }], linesCount: 1, issueDate: null, dueDate: null, lastPaidAt: null, isOverdue: false, createdAt: date } satisfies ComponentProps<typeof InvoicePrint>["invoice"];

function fixture(name: string) {
  const dir = process.env.TRANSPORT_QA_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background text-foreground"><main class="min-w-0 p-3 sm:p-5 lg:ml-60 lg:p-7">${document.body.innerHTML}</main></body></html>`);
}
beforeEach(() => {
  vi.clearAllMocks(); m.owner = true; m.permissions = [];
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  m.post.mockResolvedValue({}); m.put.mockResolvedValue({}); m.remove.mockResolvedValue({});
  m.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/bank-accounts")) return [bank, { ...bank, id: 2, bankName: "Mandiri", accountNumber: "009876543210", isActive: false }].filter(x => !url.includes("active=true") || x.isActive);
    if (url.startsWith("/finance/operational-expenses")) return expenseReport;
    if (url.endsWith("/operational-expenses")) return { rows, approvedTotal: 500_000, pendingTotal: 9_999_999_999 };
    if (url.endsWith("/expenses")) return rows.map(row => ({ ...row, transportId: 10, hasPhoto: false }));
    if (url.endsWith("/drops")) return { transportMode: "DIRECT", transportStatus: "DEPARTED", shipments: [], checkpoints: [], groups: [], progress: { total: 0, dropped: 0, approved: 0 } };
    if (url === "/options") return { customers: [{ id: 1, name: "Customer", companyName: "Customer", type: "b2b" }], b2bShipments: [] };
    if (url === "/invoices") return [invoice];
    if (url === "/invoices/1") return invoice;
    if (url === "/transports/10") return transport;
    return {};
  });
});

describe("responsive transport finance and bank management", () => {
  it("creates bank masters while preserving leading zeroes", async () => {
    const user = userEvent.setup();
    render(<BankAccountsPage />);
    await screen.findByText(bank.accountNumber);
    fixture("bank-accounts");
    await user.click(screen.getByRole("button", { name: "Tambah Rekening" }));
    await user.type(screen.getByLabelText("Bank"), "BNI");
    await user.type(screen.getByLabelText("No. Rekening"), "00012345");
    await user.type(screen.getByLabelText("Nama Rekening"), "PT KirimKu");
    await user.click(screen.getByRole("button", { name: "Simpan Rekening" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/bank-accounts", { bankName: "BNI", accountNumber: "00012345", accountName: "PT KirimKu", isActive: true }));
  });
  it("requires confirmation to deactivate a bank master", async () => {
    const user = userEvent.setup(); render(<BankAccountsPage />);
    await user.click(await screen.findByRole("button", { name: `Nonaktifkan rekening ${bank.accountNumber}` }));
    expect(m.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ya, nonaktifkan" }));
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("/bank-accounts/1"));
  });
  it("hides master-data mutations without their permissions", async () => {
    m.owner = false; m.permissions = ["bank_account.view"];
    render(<BankAccountsPage />); await screen.findByText(bank.accountNumber);
    expect(screen.queryByRole("button", { name: "Tambah Rekening" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit rekening/ })).not.toBeInTheDocument();
  });
  it("shows ANGKUT and traces shared costs to their transport", async () => {
    render(<ShipmentTransportExpenses shipmentId={1} />);
    await screen.findByText("Biaya Angkut");
    expect(screen.getByText(/Biaya bersama untuk seluruh muatan transport/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "TR-2026-000010" })[0]).toHaveAttribute("href", "/#/transports/10?tab=expenses");
    fixture("shipment-costs");
  });
  it("supports finance filters without losing the company-wide summary", async () => {
    const user = userEvent.setup(); render(<OperationalExpensesPage />);
    await screen.findByText("Total biaya disetujui");
    fixture("expense-register");
    await user.type(screen.getByRole("textbox", { name: "Cari biaya atau transport" }), "TR-10");
    await user.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => expect(m.get).toHaveBeenCalledWith(expect.stringContaining("search=TR-10")));
  });
  it("keeps transport lifecycle actions and uses mobile shipment cards", async () => {
    render(<TransportDetailPage transportId={10} />);
    await screen.findByText("Informasi Transport");
    expect(screen.getByRole("heading", { name: "TR-2026-000010" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cetak Manifest" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Biaya Operasional" })).toBeInTheDocument();
    fixture("transport-detail");
  });
  it("can open the expense tab directly from a finance row", async () => {
    render(<TransportDetailPage transportId={10} initialTab="expenses" />);
    await screen.findByText("Tambah Biaya");
    expect(screen.getByRole("tab", { name: "Biaya Operasional" })).toHaveAttribute("data-state", "active");
    fixture("transport-expenses");
  });
  it.each([
    ["transport.view", "transport.expense.create"],
    ["transport.view", "transport.expense.create", "transport.expense.update"],
  ])("lets expense creators add costs without expense view permission (%j)", async (...permissions) => {
    m.owner = false;
    m.permissions = permissions;
    render(<TransportDetailPage transportId={10} initialTab="expenses" />);
    expect(
      await screen.findByRole("button", { name: "Tambah Biaya" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Biaya Operasional" }),
    ).toHaveAttribute("data-state", "active");
    expect(m.get).not.toHaveBeenCalledWith("/transports/10/expenses");
    expect(screen.queryByText("EXP-2026-000001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tambah Biaya" }));
    expect(
      screen.getByRole("dialog", { name: "Tambah Biaya" }),
    ).toBeInTheDocument();
  });
  it("keeps expense creation hidden for view-only users", async () => {
    m.owner = false;
    m.permissions = ["transport.view", "transport.expense.view"];
    render(<TransportDetailPage transportId={10} initialTab="expenses" />);
    await screen.findByText("EXP-2026-000001");
    expect(
      screen.queryByRole("button", { name: "Tambah Biaya" }),
    ).not.toBeInTheDocument();
  });
  it("allows update-only users with view permission to edit, but not add, expenses", async () => {
    m.owner = false; m.permissions = ["transport.view", "transport.expense.view", "transport.expense.update"];
    render(<TransportDetailPage transportId={10} initialTab="expenses" />);
    const edit = await screen.findByRole("button", { name: "Edit biaya" });
    expect(screen.queryByRole("button", { name: "Tambah Biaya" })).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(screen.getByRole("dialog", { name: "Edit Biaya" })).toBeInTheDocument();
  });
  it("does not expose the expense tab without any expense permission", async () => {
    m.owner = false;
    m.permissions = ["transport.view"];
    render(<TransportDetailPage transportId={10} initialTab="expenses" />);
    await screen.findByText("Informasi Transport");
    expect(
      screen.queryByRole("tab", { name: "Biaya Operasional" }),
    ).not.toBeInTheDocument();
    expect(m.get).not.toHaveBeenCalledWith("/transports/10/expenses");
  });
  it("prints only the bank, account number and account name in payment instructions", () => {
    render(<InvoicePrint invoice={invoice} onClose={() => {}} />);
    const payment = screen.getByRole("region", { name: "Rekening pembayaran" });
    expect(within(payment).getAllByRole("term").map(x => x.textContent)).toEqual(["Bank", "No. Rekening", "Nama Rekening"]);
    expect(within(payment).getByText(bank.accountNumber)).toBeInTheDocument();
    expect(payment).not.toHaveTextContent("isActive");
    // Print portals must stay direct children of body for the shared print stylesheet.
    const dir = process.env.TRANSPORT_QA_DIR;
    if (dir) writeFileSync(join(dir, "invoice-bank.html"), `<!doctype html><html><head><meta charset="utf-8"></head><body>${document.body.innerHTML}</body></html>`);
  });
  it("lets invoice editors choose an active account", async () => {
    const user = userEvent.setup(); render(<InvoicesPage />);
    await screen.findAllByText("INV-PRINT-BANK");
    await user.click(screen.getByRole("button", { name: "Buat Invoice" }));
    const picker = screen.getByRole("combobox", { name: "Rekening pembayaran" });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    await user.click(await screen.findByRole("option", { name: /BCA.*001234567890/ }));
    expect(picker).toHaveTextContent(bank.accountNumber);
    expect(screen.queryByRole("option", { name: /Mandiri/ })).not.toBeInTheDocument();
  });
});
