// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData, FinanceSummary } from "@/infrastructure/http/client-api";

const m = vi.hoisted(() => ({ get: vi.fn(), user: { name: "Andi Pratama", isOwner: true, permissions: [] as string[] } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get, hasPermission: (_user: unknown, permission: string) => m.user.isOwner || m.user.permissions.includes(permission) }));
import { DashboardPage } from "@/components/app/pages/dashboard-page";
import { FinancePage } from "@/components/app/pages/finance-page";

const date = "2026-10-16T09:00:00Z";
const longName = "PT Nusantara Logistik Internasional Cabang Medan";
const dashboard: DashboardData = {
  role: "owner", permissions: { canVerifyTopup: true, canApproveWithdrawal: true, canReviewWithdrawal: true, canVerifyPayment: true, canReleaseCommission: true },
  period: { from: "2026-10-16", to: "2026-10-16", days: 1 },
  counts: { shipments: 1284, activePickups: 24, pendingDeliveries: 16, inTransit: 38, customers: 248, gudang: 12, vehicles: 64, invoices: 320 },
  approvals: {
    pendingTopups: [{ id: 1, requestCode: "TOPUP-2026-000001", amount: 99_999_999_999, partnerName: longName, createdAt: date, proofUrl: "data:image/png;base64,AA" }],
    pendingWithdrawals: [{ id: 2, requestCode: "WDR-2026-000002", amount: 98_000_000, partnerName: longName, bankName: "BCA", bankAccountNumber: "1234567890", createdAt: date }],
    pendingPayments: [{ id: 3, masterCode: "MS-2026-000001", amount: 25_000_000, partnerName: longName, customerName: longName, method: "TRANSFER", recordedByName: "Andi" }],
    pendingCommissions: [{ id: 4, commissionCode: "COM-2026-000001", invoiceNumber: "INV-2026-000001", invoiceStatus: "PARTIALLY_SETTLED", amount: 7_000_000, partnerName: longName }],
  },
  statusCounts: { CREATED: 180, READY_FOR_PICKUP: 120, PICKED_UP: 84, RECEIVED_AT_GUDANG: 150, IN_TRANSPORT: 220, AT_DEST_GUDANG: 180, ARRIVED_AT_GUDANG: 40, DELIVERED: 310 },
  revenueVerified: 750_000_000,
  recentShipments: [{ id: 1, masterCode: "MS-2026-000001", customerName: longName, origin: "Medan", destination: "Jakarta", status: "IN_TRANSPORT", createdAt: date }],
  recentAudit: [{ id: 1, action: "updated", actorName: "Andi Pratama", entityLabel: "INV-2026-000001", entityType: "invoice", createdAt: date }],
  marketing: null, gudang: null,
  capacitySummary: { activeTransports: 38, overCapacityTransports: 2, warningTransports: 5, partiallyConfiguredTransports: 3, vehiclesOverWeight: 2, vehiclesOverVolume: 1, vehiclesOverKoli: 0 },
};
const finance: FinanceSummary = {
  totals: { partnerCount: 48, marketingCount: 32, vehicleOwnerCount: 16, totalWalletBalance: 1_250_000_000, totalReserved: 100_000_000, totalAvailable: 1_150_000_000, verifiedTopUps: 450_000_000, releasedCommissions: 53_000_000, transportSharePaid: 210_000_000, transportValueSettled: 420_000_000, repairDeductions: 12_500_000, withdrawalsCompleted: 180_000_000, unsettledArrivedTransports: 6, realizedInvoicePayments: 2_450_000_000, settledInvoicePayments: 2_000_000_000, partialInvoicePayments: 450_000_000 },
  pending: {
    topUps: [{ id: 1, requestCode: "TOPUP-2026-000001", partnerName: longName, partnerType: "MARKETING", amount: 99_999_999_999, status: "PENDING_VERIFICATION", createdAt: date }],
    withdrawals: [{ id: 2, requestCode: "WDR-2026-000002", partnerName: longName, partnerType: "MARKETING", amount: 98_000_000, status: "PROCESSING", bankName: "BCA", bankAccountNumber: "1234567890", createdAt: date }],
    repairs: [{ id: 3, repairCode: "REP-000001", vehicleNumber: "BK 1234 AA", ownerName: longName, amount: 1_500_000, status: "VERIFIED", createdAt: date }],
    commissions: [{ id: 4, commissionCode: "COM-000001", partnerName: longName, invoiceNumber: "INV-2026-000001", commissionAmount: 7_000_000, createdAt: date }],
  },
  partners: [
    { id: 1, name: longName, username: "partner", type: "MARKETING", profitShare: { company: 80, partner: 20 }, walletBalance: 99_999_999_999_999, vehicleCount: 0 },
    { id: 2, name: "PT Armada Nusantara", username: "armada", type: "VEHICLE_OWNER", profitShare: { company: 50, partner: 50 }, walletBalance: 250_000_000, vehicleCount: 12 },
  ],
  invoicePayments: { realized: 2_450_000_000, settledTotal: 2_000_000_000, partialTotal: 450_000_000, byMonth: [], recent: [
    { id: 1, amount: 100_000_000, method: "TRANSFER", reference: null, hasProof: true, settledAt: date, invoiceNumber: "INV-2026-000001", invoiceStatus: "SETTLED", customerName: longName },
    { id: 2, amount: 9_999_999_999_999, method: "TRANSFER", reference: null, hasProof: false, settledAt: date, invoiceNumber: "INV-2026-000002", invoiceStatus: "PARTIALLY_SETTLED", customerName: "CUSTOMER_WITH_A_VERY_LONG_UNBROKEN_IDENTIFIER_123456789012345678901234567890" },
  ] },
  monthlyLedger: [4, 5, 6, 7, 8, 9].map((month, i) => ({ month: `2026-${String(month).padStart(2, "0")}`, byType: { TOPUP: (i + 1) * 15_000_000, WITHDRAWAL: -(i + 1) * 8_000_000, COMMISSION: 12_000_000, TRANSPORT_PROFIT_SHARE: 30_000_000, REPAIR_DEDUCTION: -1_000_000 } })),
};
function fixture(name: string) {
  const dir = process.env.DASHBOARD_QA_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background text-foreground"><div class="flex min-w-0"><aside class="hidden w-60 shrink-0 border-r bg-card p-6 lg:block"><p class="text-xl font-bold text-primary">KirimKu</p><p class="mt-8 text-sm text-muted-foreground">Dashboard</p></aside><main class="min-w-0 flex-1 p-3 sm:p-5 lg:p-7">${document.body.innerHTML}</main></div></body></html>`;
  writeFileSync(join(dir, `${name}.html`), html);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user = { name: "Andi Pratama", isOwner: true, permissions: [] };
  m.get.mockImplementation(async (url: string) => url.startsWith("/dashboard") ? dashboard : url === "/finance/summary" ? finance : { buckets: [], total: 0 });
});

describe("dashboard redesign", () => {
  it("retains operational metrics, approval counts, shipment links and the period filter", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await screen.findByText("Sekilas operasional");
    expect(screen.getByText("4 menunggu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pickup Aktif/ })).toHaveAttribute("href", "/pickups");
    expect(screen.getByRole("link", { name: /MS-2026-000001/ })).toHaveAttribute("href", "#/shipments/1");
    await screen.findByText("Tidak ada perubahan kapasitas dalam periode ini.");
    fixture("dashboard-owner");
    await user.click(screen.getByRole("button", { name: /7 Hari/ }));
    await waitFor(() => expect(m.get.mock.calls.filter(([url]) => String(url).startsWith("/dashboard"))).toHaveLength(2));
  });
  it("preserves the marketing workspace without exposing owner approval queues", async () => {
    m.user.isOwner = false;
    m.user.permissions = ["shipment.view", "customer.view", "invoice.view"];
    m.get.mockResolvedValue({ ...dashboard, role: "marketing", permissions: { canVerifyTopup: false, canApproveWithdrawal: false, canReviewWithdrawal: false, canVerifyPayment: false, canReleaseCommission: false }, marketing: {
      wallet: { balance: 500_000_000, available: 490_000_000, reserved: 10_000_000 }, pendingCommission: 7_000_000, releasedCommission: 53_000_000,
      pendingWithdrawals: [{ id: 1, amount: 10_000_000 }], recentCommissions: [{ id: 1, commissionCode: "COM-000001", customerName: longName, invoiceNumber: "INV-000001", amount: 99_999_999_999, status: "PENDING" }], recentTransactions: [{ id: 1, type: "COMMISSION", direction: "CREDIT", amount: 50_000_000, description: longName, createdAt: date }],
    } });
    render(<DashboardPage />);
    await screen.findByText("Saldo Tersedia");
    expect(screen.queryByText("Perlu perhatian Anda")).not.toBeInTheDocument();
    expect(screen.queryByText("Kapasitas Armada")).not.toBeInTheDocument();
    fixture("dashboard-marketing");
  });
  it("retains warehouse scan queues and scope", async () => {
    m.user.isOwner = false;
    m.user.permissions = ["shipment.view", "warehouse.view", "pickup.view", "delivery.view", "transport.view"];
    m.get.mockResolvedValue({ ...dashboard, role: "admin-gudang", permissions: {}, gudang: {
      scope: { scoped: true, warehouseId: 1, warehouseName: "Medan" }, arrivals: [{ id: 1, masterCode: "MS-000001", customerName: longName, origin: "Medan", destination: "Jakarta", scannedCount: 2, detailsCount: 5 }],
      transportArrivals: [{ id: 2, masterCode: "MS-000002", customerName: longName, transportCode: "TR-000001", scannedCount: 0, detailsCount: 2 }], walkIns: [], heldSummary: [{ warehouseId: 1, warehouseName: "Medan", city: "Medan", heldShipments: 120, heldPackages: 480, heldWeightKg: 2500, unpaidCount: 0 }],
    } });
    render(<DashboardPage />);
    await screen.findByText("Antrian Scan Pickup");
    expect(screen.getByText("Gudang Medan")).toBeInTheDocument();
    fixture("dashboard-warehouse");
  });
  it("shows the pending commission total, all financial sections and large values", async () => {
    render(<FinancePage />);
    await screen.findByText("Saldo & distribusi dana");
    const pending = screen.getByText("Komisi belum dirilis").closest("dt")!;
    expect(pending.parentElement).toHaveTextContent("Rp7.000.000");
    expect(screen.getByRole("link", { name: /Kelola partner/ })).toHaveAttribute("href", "#/partners");
    expect(screen.getByText("Pergerakan dana")).toBeInTheDocument();
    expect(screen.getByText("Ledger 6 Bulan Terakhir")).toBeInTheDocument();
    fixture("finance-populated");
  });
  it("shows useful empty states for a new finance dashboard", async () => {
    const totals = Object.fromEntries(Object.keys(finance.totals).map(key => [key, 0]));
    m.get.mockResolvedValue({ ...finance, totals, pending: { topUps: [], withdrawals: [], repairs: [], commissions: [] }, partners: [], monthlyLedger: [], invoicePayments: { realized: 0, settledTotal: 0, partialTotal: 0, recent: [], byMonth: [] } });
    render(<FinancePage />);
    await screen.findByText("Belum ada pembayaran invoice.");
    expect(screen.getByText("Belum ada partner terdaftar.")).toBeInTheDocument();
    fixture("finance-empty");
  });
  it("does not fetch or expose finance data without permission", async () => {
    m.user.isOwner = false;
    render(<FinancePage />);
    expect(screen.getByText(/Anda tidak memiliki izin/)).toBeInTheDocument();
    expect(m.get).not.toHaveBeenCalled();
  });
  it.each([DashboardPage, FinancePage])("lets a failed dashboard request be retried", async (Page) => {
    m.get.mockRejectedValueOnce(new Error("Connection failed"));
    const user = userEvent.setup();
    render(<Page />);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
