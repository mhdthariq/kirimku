// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";

const m = vi.hoisted(() => ({
  post: vi.fn(), permissions: [] as string[], employeeId: 1 as number | null, owner: false,
  mode: "ACTIVITY", status: "PLANNED", role: "driver",
  dropStatus: "DELIVERY_PENDING", deliveryApprovedAt: null as string | null,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { employeeId: m.employeeId, isOwner: m.owner, roles: [{ slug: m.role }] } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({
  apiGet: async (url: string) => url.endsWith("/drops") ? {
    transportMode: "DIRECT", transportStatus: m.status, deliveryApprovedAt: m.deliveryApprovedAt,
    checkpoints: [],
    shipments: [{ shipmentId: 20, masterCode: "RESI-20", customerName: "Customer", dropCheckpointId: null, dropStatus: m.dropStatus }],
    groups: [{ checkpointId: null, shipmentIds: [20] }],
    progress: { total: 1, dropped: 1, approved: m.dropStatus === "DELIVERY_APPROVED" ? 1 : 0, allApproved: m.dropStatus === "DELIVERY_APPROVED" },
    vehicleEmpty: true,
  } : {
    id: 10, transportCode: "TR-10", trackingMode: m.mode, transportMode: "DIRECT", status: m.status,
    origin: "A", destination: "B", vehicle: { id: 2, vehicleNumber: "BK-1" }, driver: { id: 1, name: "Driver" }, kenek: null,
    checkpoints: [], checkpointRecords: [], shipments: [], shipmentCount: 0, totalWeightKg: 0, totalVolumeM3: 0, totalPrice: 0,
  },
  apiPost: m.post, apiDelete: vi.fn(), hasPermission: (_user: unknown, permission: string) => m.permissions.includes(permission),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/app/transport-activities-panel", () => ({ TransportActivitiesPanel: ({ canCreate }: { canCreate: boolean }) => <div data-testid="activities">Activity panel {canCreate ? "editable" : "readonly"}</div> }));
vi.mock("@/components/app/transport-expenses-panel", () => ({ TransportExpensesPanel: () => <div>Expense approval panel</div> }));
vi.mock("@/components/app/transport-form-dialog", () => ({ TransportFormDialog: () => null }));
vi.mock("@/components/app/checkpoint-checkin-dialog", () => ({ CheckpointCheckinDialog: () => null }));
vi.mock("@/components/app/transport-manifest-print", () => ({ TransportManifestPrint: () => null }));
vi.mock("@/components/app/photo-detail-dialog", () => ({ PhotoDetailDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks(); m.employeeId = 1; m.owner = false; m.role = "driver"; m.mode = "ACTIVITY"; m.status = "PLANNED";
  m.dropStatus = "DELIVERY_PENDING"; m.deliveryApprovedAt = null;
  m.permissions = ["transport.checkin", "transport.depart", "transport.arrive", "transport.expense.view"];
  m.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/depart")) m.status = "DEPARTED";
    else if (url.endsWith("/arrive")) m.status = "ARRIVED";
    else if (url.endsWith("/approve")) m.dropStatus = "DELIVERY_APPROVED";
    else if (url.endsWith("/delivery-approval")) m.deliveryApprovedAt = "2026-10-13T10:00:00Z";
    return {};
  });
});

describe("activity transport detail", () => {
  it("focuses driver on Activity and expenses while preserving metadata and lifecycle actions", async () => {
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("activities")).toHaveTextContent("editable");
    expect(screen.queryByRole("tab", { name: "Checkpoint" })).not.toBeInTheDocument();
    expect(screen.queryByText("Penurunan & Approval Resi")).not.toBeInTheDocument();
    expect(screen.queryByText("Shipment dalam Transport")).not.toBeInTheDocument();
    expect(screen.getByText("Informasi Transport")).toBeInTheDocument();
    expect(screen.getByText("BK-1")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Biaya Operasional" }));
    expect(await screen.findByText("Expense approval panel")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Berangkat" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/depart", {}));
    fireEvent.click(await screen.findByRole("button", { name: "Tandai Tiba" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, tandai tiba" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/arrive", {}));
    await waitFor(() => expect(screen.getByTestId("activities")).toHaveTextContent("readonly"));
  });
  it("gates lifecycle by the specific depart/arrive permissions, not checkin", async () => {
    m.permissions = ["transport.checkin"];
    render(<TransportDetailPage transportId={10} />);
    await screen.findByTestId("activities");
    expect(screen.queryByRole("button", { name: "Berangkat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tandai Tiba" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Biaya Operasional" })).not.toBeInTheDocument();
  });
  it("does not let an unassigned owner create activity evidence", async () => {
    m.employeeId = 99; m.owner = true; m.role = "owner";
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByTestId("activities")).toHaveTextContent("readonly");
    expect(screen.getByText("Shipment dalam Transport")).toBeInTheDocument();
  });
  it("keeps admin shipment approval, transport approval and return-task creation reachable for activity without checkpoints", async () => {
    m.employeeId = 99; m.role = "admin-gudang"; m.status = "ARRIVED";
    m.permissions = ["transport.delivery.approve", "return-task.create"];
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByText("Penurunan & Approval Resi")).toBeInTheDocument();
    expect(screen.getByText("Tujuan akhir")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Checkpoint" })).not.toBeInTheDocument();
    expect(screen.queryByText("Check-in Checkpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/belum check-in/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Setujui" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/drops/20/approve", {}));
    fireEvent.click(await screen.findByRole("button", { name: "Setujui Delivery Transport" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/delivery-approval", {}));
    fireEvent.click(await screen.findByRole("button", { name: "Buat Resi Tugas Balik" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/return-task", {}));
  });
  it("keeps activity admin approval and return actions permission-gated", async () => {
    m.employeeId = 99; m.role = "admin-gudang"; m.status = "ARRIVED";
    m.permissions = []; m.deliveryApprovedAt = "2026-10-13T10:00:00Z";
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByText("Penurunan & Approval Resi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setujui" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setujui Delivery Transport" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buat Resi Tugas Balik" })).not.toBeInTheDocument();
  });
  it("preserves checkpoint tracking without manual activity lifecycle controls", async () => {
    m.mode = "CHECKPOINT";
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByRole("tab", { name: "Checkpoint" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("activities")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Berangkat" })).not.toBeInTheDocument();
    expect(await screen.findByText("Penurunan & Approval Resi")).toBeInTheDocument();
    expect(screen.getByText("Shipment dalam Transport")).toBeInTheDocument();
  });
});
