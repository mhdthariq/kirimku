// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShipmentsPage } from "../../../src/components/app/pages/shipments-page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn(), fetch: vi.fn(),
  permissions: ["shipment.view", "shipment.create", "shipment.confirm_arrival", "shipment_detail.create", "shipment_detail.update", "shipment_detail.delete"],
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { permissions: mocks.permissions, isOwner: false } }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("../../../src/infrastructure/http/client-api")>(),
  apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, apiDelete: mocks.remove, apiFetch: mocks.fetch,
}));
vi.mock("@/components/app/resi-print", () => ({ ResiPrint: () => null }));
vi.mock("@/components/app/item-audit-dialog", () => ({ ItemAuditDialog: () => null }));
vi.mock("@/components/app/walk-in-dialog", () => ({ WalkInDialog: () => null }));
vi.mock("@/components/app/arrival-scan-dialog", () => ({ ArrivalScanDialog: () => null }));
// Native selects keep these page tests focused on form behavior, not Radix interaction.
vi.mock("@/components/app/form-parts", async (original) => ({
  ...await original<typeof import("../../../src/components/app/form-parts")>(),
  FormSelect: ({ value, onValueChange, options, placeholder }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string }) => (
    <select aria-label={placeholder ?? "Select"} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

const detail = { id: 11, masterId: 7, detailCode: "DTL-11", description: "Karton", lengthCm: null, widthCm: null, heightCm: null, volumeM3: 0.009, actualWeightKg: 2 };
let shipment: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "#/shipments";
  shipment = { id: 7, masterCode: "SHP-7", status: "CREATED", fulfillmentMode: "STANDARD", origin: "A", destination: "B", createdAt: "2026-10-01", details: [detail, { ...detail, id: 12, detailCode: "DTL-12" }], trackingEvents: [] };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === "/options") return { customers: [{ id: 1, name: "Sender", type: "regular", code: "C1" }], tariffs: [{ id: 2, origin: "A", destination: "B", customerType: "regular", ratePerKg: 1000, effectiveFrom: "2020-01-01", effectiveTo: null, isActive: true }], warehouses: [] };
    if (path === "/gudang") return { scope: { scoped: false }, arrivals: [], transportArrivals: [] };
    if (path === "/shipments") return [];
    return shipment;
  });
  mocks.post.mockResolvedValue({ id: 99 });
  mocks.put.mockResolvedValue({ updated: 2 });
  mocks.fetch.mockResolvedValue({ deleted: 2 });
});

async function openGrouped() {
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Tambah Detail" });
  await user.click(screen.getByRole("tab", { name: "Ringkas (1)" }));
  return user;
}

describe("ShipmentsPage requested UI changes", () => {
  it("retains leading-zero decimal typing and paste, converting only on submit", async () => {
    render(<ShipmentsPage shipmentId={7} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Tambah Detail" }));
    const dialog = screen.getByRole("dialog");
    const volume = within(dialog).getByLabelText("Volume langsung (m³) - opsional");
    await user.type(volume, "0.009");
    expect(volume).toHaveValue("0.009");
    await user.clear(volume);
    await user.click(volume);
    await user.paste("0.025");
    expect(volume).toHaveValue("0.025");
    await user.type(within(dialog).getByLabelText("Deskripsi"), "Box");
    await user.type(within(dialog).getByLabelText("Berat aktual (kg)"), "2");
    await user.click(within(dialog).getByRole("button", { name: "Buat Paket" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/shipments/7/details", expect.objectContaining({ volumeM3: 0.025 })));
  });

  it.each(["CREATED", "READY_FOR_PICKUP"])("hides warehouse arrival for DIRECT %s while retaining STANDARD arrival", async (status) => {
    shipment.status = status;
    shipment.fulfillmentMode = "DIRECT";
    const view = render(<ShipmentsPage shipmentId={7} />);
    await screen.findByText("SHP-7");
    expect(screen.queryByRole("button", { name: "Tiba di Gudang" })).not.toBeInTheDocument();
    view.unmount();
    shipment.fulfillmentMode = "STANDARD";
    render(<ShipmentsPage shipmentId={7} />);
    expect(await screen.findByRole("button", { name: "Tiba di Gudang" })).toBeInTheDocument();
  });

  it("edits every grouped ID in a single batch request, without changing package count", async () => {
    render(<ShipmentsPage shipmentId={7} />);
    const user = await openGrouped();
    await user.click(screen.getAllByRole("button", { name: "Edit semua 2 paket Karton" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Jumlah paket")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Deskripsi"), { target: { value: "Updated" } });
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/shipments/7/details/batch", expect.objectContaining({ detailIds: [11, 12], description: "Updated" })));
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put.mock.calls[0][1]).not.toHaveProperty("quantity");
  });

  it("confirms grouped deletion and sends every ID in one atomic request", async () => {
    render(<ShipmentsPage shipmentId={7} />);
    const user = await openGrouped();
    await user.click(screen.getAllByRole("button", { name: "Hapus semua 2 paket Karton" })[0]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/shipments/7/details/batch", { method: "DELETE", body: { detailIds: [11, 12] } }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps a failed grouped edit open without falling back to individual updates", async () => {
    mocks.put.mockRejectedValue(new Error("Batch endpoint unavailable"));
    render(<ShipmentsPage shipmentId={7} />);
    const user = await openGrouped();
    await user.click(screen.getAllByRole("button", { name: "Edit semua 2 paket Karton" })[0]);
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.put.mock.calls[0][0]).toBe("/shipments/7/details/batch");
  });

  it("navigates to the returned shipment ID after creation", async () => {
    render(<ShipmentsPage shipmentId={null} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Buat Shipment" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Pilih customer…" }), "1");
    const selects = within(screen.getByRole("dialog")).getAllByRole("combobox");
    const route = selects.find((select) => within(select).queryByRole("option", { name: /A.*B/ }));
    expect(route).toBeDefined();
    await user.selectOptions(route!, "2");
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await waitFor(() => expect(window.location.hash).toBe("#/shipments/99"));
  });
});
