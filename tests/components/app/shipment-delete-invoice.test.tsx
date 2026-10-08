// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { isOwner: false, permissions: [] as string[] }, get: vi.fn(), delete: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: mocks.get, apiDelete: mocks.delete,
}));
vi.mock("@/components/app/data-table", () => ({
  PageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header>{title}{actions}</header>,
  DataTable: ({ rows, columns, toolbar }: { rows: Record<string, unknown>[]; columns: { key: string; render: (row: Record<string, unknown>) => React.ReactNode }[]; toolbar: React.ReactNode }) => <>{toolbar}<table><tbody>{rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody></table></>,
}));
vi.mock("@/components/app/resi-print", () => ({ ResiPrint: () => null }));
vi.mock("@/components/app/arrival-scan-dialog", () => ({ ArrivalScanDialog: () => null }));
vi.mock("@/components/app/walk-in-dialog", () => ({ WalkInDialog: () => null }));
vi.mock("@/components/app/item-audit-dialog", () => ({ ItemAuditDialog: () => null }));
import { ShipmentsPage } from "@/components/app/pages/shipments-page";

const invoiceLines = [{ invoice: { id: 8, invoiceNumber: "INV-CANCELLED", status: "CANCELLED" } }];
const base = { id: 1, masterCode: "MS-CANCELLED", status: "CANCELLED", origin: "Jakarta", destination: "Bandung", createdAt: "2026-01-01", details: [], trackingEvents: [], pickups: [], deliveries: [], payments: [], transportItems: [], invoiceLines, customer: { id: 1, name: "Customer", type: "b2b" }, _count: { details: 0, pickups: 0, deliveries: 0, payments: 0 } };
const unbilled = { ...base, id: 2, masterCode: "MS-UNBILLED", status: "CREATED", invoiceLines: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { isOwner: false, permissions: ["shipment.view"] };
  mocks.get.mockImplementation(async (path: string) => path === "/shipments" ? [base, unbilled] : path.startsWith("/shipments/") ? base : {});
  mocks.delete.mockResolvedValue({ deleted: true });
});

describe("shipment invoice and deletion controls", () => {
  it("filters invoice membership using existing lines, including cancelled invoice lines", async () => {
    const user = userEvent.setup();
    render(<ShipmentsPage shipmentId={null} />);
    await screen.findByText("MS-CANCELLED");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter invoice" }), "on_invoice");
    expect(screen.getByText("MS-CANCELLED")).toBeInTheDocument();
    expect(screen.queryByText("MS-UNBILLED")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter invoice" }), "not_invoice");
    expect(screen.getByText("MS-UNBILLED")).toBeInTheDocument();
    expect(screen.queryByText("MS-CANCELLED")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter invoice" }), "all");
    expect(screen.getByText("MS-CANCELLED")).toBeInTheDocument();
    expect(screen.getByText("MS-UNBILLED")).toBeInTheDocument();
  });
  it.each([
    [[], 0], [["shipment.delete"], 1], [["shipment.delete_cancelled"], 1], [["shipment.delete", "shipment.delete_cancelled"], 2],
  ])("gates list delete controls independently for %j", async (permissions, count) => {
    mocks.user.permissions = ["shipment.view", ...permissions];
    render(<ShipmentsPage shipmentId={null} />);
    await screen.findByText("MS-CANCELLED");
    expect(screen.queryAllByRole("button", { name: "Hapus shipment" })).toHaveLength(count);
    if (permissions.length === 1) {
      const button = screen.getByRole("button", { name: "Hapus shipment" });
      expect(button.closest("tr")).toHaveTextContent(permissions[0] === "shipment.delete" ? "MS-UNBILLED" : "MS-CANCELLED");
    }
  });
  it("does not grant cancelled detail deletion through shipment.delete", async () => {
    mocks.user.permissions = ["shipment.view", "shipment.delete"];
    render(<ShipmentsPage shipmentId={1} />);
    await screen.findByText("MS-CANCELLED");
    expect(screen.queryByRole("button", { name: "Hapus shipment" })).not.toBeInTheDocument();
  });
  it("confirms cancelled detail deletion and navigates only after success", async () => {
    mocks.user.permissions = ["shipment.view", "shipment.delete_cancelled"];
    const user = userEvent.setup();
    render(<ShipmentsPage shipmentId={1} />);
    await user.click(await screen.findByRole("button", { name: "Hapus shipment" }));
    expect(mocks.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith("/shipments/1"));
    await waitFor(() => expect(window.location.hash).toBe("#/shipments"));
  });
});
