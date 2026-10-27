// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), permissions: [] as string[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: false } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({
  apiGet: m.get, apiPost: m.post, apiDelete: vi.fn(),
  hasPermission: (_user: unknown, permission: string) => m.permissions.includes(permission),
}));
vi.mock("@/components/app/data-table", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  DataTable: ({ rows, columns, toolbar }: { rows: { id: number }[]; columns: { key: string; render: (row: unknown) => ReactNode }[]; toolbar: ReactNode }) => (
    <div>{toolbar}{rows.map((row) => <div key={row.id} data-testid={`trip-${row.id}`}>{columns.map((column) => <div key={column.key}>{column.render(row)}</div>)}</div>)}</div>
  ),
}));
vi.mock("@/components/app/activity-log-panel", () => ({ ActivityLogPanel: () => null }));
vi.mock("@/components/app/item-audit-dialog", () => ({ ItemAuditDialog: () => null }));
vi.mock("@/components/app/transport-form-dialog", () => ({ TransportFormDialog: () => null }));
vi.mock("@/components/app/capacity-status-card", () => ({ CapacitySummaryInline: () => null }));
vi.mock("@/components/app/status-badge", () => ({ StatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TransportsPage } from "@/components/app/pages/transports-page";

beforeEach(() => {
  vi.clearAllMocks();
  m.permissions = ["transport.view", "transport.create", "transport.arrive", "transport.complete", "transport.settle"];
  m.post.mockResolvedValue({});
  const rows = ["DEPARTED", "ARRIVED", "COMPLETED"].map((status, i) => ({
    id: i + 1, transportCode: `TRP-${i + 1}`, status, vehicleNumber: "BK-1", vehicleOwnerId: 3,
    shipments: [], settlement: null, routeCheckpoints: [],
  }));
  m.get.mockImplementation(async (url: string) => url === "/options" ? { warehouses: [] } : rows);
});

describe("transport list completion actions", () => {
  it("opens only confirmation for a photo-exempt activity arrival from the list", async () => {
    m.permissions.push("transport.arrive_without_photo");
    m.get.mockImplementation(async (url: string) => url === "/options" ? { warehouses: [] } : [{
      id: 1, transportCode: "TRP-1", status: "DEPARTED", trackingMode: "ACTIVITY", vehicleNumber: "BK-1",
      shipments: [], settlement: null, routeCheckpoints: [],
    }]);
    render(<TransportsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai Tiba" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(m.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ya, Tandai Tiba" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/1/arrive"));
  });
  it("separates arrival from auditor completion and never reopens completed rows", async () => {
    render(<TransportsPage />);
    const departed = within(await screen.findByTestId("trip-1"));
    const arrived = within(screen.getByTestId("trip-2"));
    const completed = within(screen.getByTestId("trip-3"));
    expect(departed.getByRole("button", { name: "Tandai Tiba" })).toBeInTheDocument();
    expect(departed.queryByRole("button", { name: "Konfirmasi Completed" })).not.toBeInTheDocument();
    fireEvent.click(arrived.getByRole("button", { name: "Konfirmasi Completed" }));
    expect(screen.getByText(/Auditor terpisah/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ya, Konfirmasi Completed" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/2/complete"));
    expect(completed.queryByRole("button", { name: /Tandai Tiba|Konfirmasi Completed|Edit|Hapus|Depart/ })).not.toBeInTheDocument();
    expect(completed.getByRole("button", { name: "Settle" })).toBeInTheDocument();
    expect(arrived.getByRole("button", { name: "Settle" })).toBeInTheDocument();
  });

  it("arrival permission alone cannot confirm completion", async () => {
    m.permissions = ["transport.view", "transport.arrive"];
    render(<TransportsPage />);
    await screen.findByTestId("trip-2");
    expect(screen.queryByRole("button", { name: "Konfirmasi Completed" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tandai Tiba" }));
    expect(screen.getByText(/bukan COMPLETED/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ya, Tandai Tiba" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/1/arrive"));
  });

  it.each([false, true])("filters completed rows in historyMode=%s", async (historyMode) => {
    render(<TransportsPage historyMode={historyMode} />);
    await screen.findByTestId("trip-3");
    fireEvent.click(screen.getByRole("button", { name: /^Selesai/ }));
    expect(screen.getByTestId("trip-3")).toBeInTheDocument();
    expect(screen.queryByTestId("trip-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trip-1")).not.toBeInTheDocument();
  });
});
