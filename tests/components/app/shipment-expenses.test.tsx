// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Shipment } from "@/infrastructure/http/client-api";
const m = vi.hoisted(() => ({ post: vi.fn(), remove: vi.fn(), reload: vi.fn(), canCreate: true, rows: [] as unknown[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: true } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiPost: m.post, apiDelete: m.remove, apiGet: vi.fn(), hasPermission: () => true }));
vi.mock("@/hooks/use-api-data", () => ({ useApiData: () => ({ data: { rows: m.rows, canCreate: m.canCreate }, reload: m.reload }), runAction: async (fn: () => Promise<unknown>) => { await fn(); return true; } }));
import { ShipmentExpenses, UndoShipmentArrival } from "@/components/app/shipment-expenses";
import { CustomerPriceStatus } from "@/components/app/shipment-payments";
const expense = { id: 1, expenseCode: "EXP-1", type: "BBM", amount: 100_000, status: "APPROVED", description: "Bensin perjalanan", createdAt: "2026-10-19T00:00:00Z", transport: null, shipment: { id: 12, masterCode: "B2B-12", origin: "Medan", destination: "Jakarta" }, approvedByUsername: "andi", approvedByRole: "Owner" };
beforeEach(() => { vi.clearAllMocks(); m.rows = []; m.canCreate = true; m.post.mockResolvedValue({}); m.remove.mockResolvedValue({}); });

describe("shipment expense controls", () => {
  it("submits the warehouse expense without driver GPS requirements", async () => {
    render(<ShipmentExpenses shipmentId={12} />);
    fireEvent.change(screen.getByLabelText("Nominal biaya shipment"), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah Biaya Shipment" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/shipments/12/operational-expenses", { type: "BONGKAR", amount: 100_000, description: "" }));
    expect(m.reload).toHaveBeenCalled();
  });
  it("hides entry when warehouse receipt or shipment eligibility is missing", () => {
    m.canCreate = false; render(<ShipmentExpenses shipmentId={12} />);
    expect(screen.queryByRole("button", { name: "Tambah Biaya Shipment" })).not.toBeInTheDocument();
  });
  it("keeps approved expense details and requires a cancellation reason", async () => {
    m.rows = [expense]; render(<ShipmentExpenses shipmentId={12} />);
    expect(screen.getByText("Approve (100%)")).toBeInTheDocument();
    expect(screen.getByText("Approve by andi (Owner)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Batalkan approval" }));
    expect(screen.getByRole("button", { name: "Konfirmasi" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Alasan perubahan biaya"), { target: { value: "Duplikat" } });
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/shipments/12/operational-expenses/1", { action: "cancel", reason: "Duplikat" }));
  });
  it("removes an approved expense with its required reason", async () => {
    m.rows = [expense]; render(<ShipmentExpenses shipmentId={12} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus biaya" }));
    fireEvent.change(screen.getByLabelText("Alasan perubahan biaya"), { target: { value: "Salah input" } });
    fireEvent.click(screen.getByRole("button", { name: "Konfirmasi" }));
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("/shipments/12/operational-expenses/1", { reason: "Salah input" }));
  });
  it("shows cancelled reasons without counting the expense or offering approval again", () => {
    m.rows = [{ ...expense, status: "CANCELLED", cancellationReason: "Duplikat" }]; render(<ShipmentExpenses shipmentId={12} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Alasan: Duplikat")).toBeInTheDocument();
    expect(screen.getByText("Approve (0%)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
  });
  it("submits undo arrival with a reason and refreshes shipment data", async () => {
    const changed = vi.fn(); render(<UndoShipmentArrival shipmentId={12} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo tiba di gudang" }));
    fireEvent.change(screen.getByLabelText("Alasan undo penerimaan"), { target: { value: "Gudang salah" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo penerimaan" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/shipments/12/undo-arrival", { reason: "Gudang salah" }));
    expect(changed).toHaveBeenCalled();
  });
  it("provides a responsive visual fixture with long amounts and names", () => {
    m.rows = [{ ...expense, amount: 9_999_999_999, approvedByUsername: "pemilik-dengan-nama-sangat-panjang", cancellationReason: "Pembatalan dengan keterangan yang panjang untuk pemeriksaan tampilan di layar kecil.", status: "CANCELLED" }, { ...expense, id: 2 }];
    render(<main className="mx-auto min-w-0 max-w-6xl space-y-6 p-3 sm:p-6"><section className="min-w-0 rounded-xl border bg-card p-4"><h2>Harga & Pembayaran Customer B2C</h2><CustomerPriceStatus shipment={{ priceAmount: 200_000, finalPriceAmount: 200_000, payments: [{ amount: 100_000, status: "VERIFIED" }] } as Shipment} detailed /></section><ShipmentExpenses shipmentId={12} /><UndoShipmentArrival shipmentId={12} onChanged={async () => {}} /></main>);
    const directory = process.env.EXPENSE_QA_DIR;
    if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "expenses.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body>${document.body.innerHTML}</body></html>`); }
    expect(screen.getByText("Sebagian")).toBeInTheDocument();
  });
});

describe("B2C customer price status", () => {
  it.each([[[], "Belum Lunas"], [[{ amount: 100_000, status: "RECORDED" }], "Belum Lunas"], [[{ amount: 50_000, status: "VERIFIED" }], "Sebagian"], [[{ amount: 100_000, status: "VERIFIED" }], "Lunas"]])("counts verified customer payments only %#", (payments, label) => {
    render(<CustomerPriceStatus shipment={{ priceAmount: 100_000, finalPriceAmount: 100_000, payments } as Shipment} />);
    expect(screen.getByText(label as string)).toBeInTheDocument();
  });
});
