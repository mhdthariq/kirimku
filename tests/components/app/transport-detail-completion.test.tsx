// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";
import { formatDate } from "@/components/app/form-parts";

const m = vi.hoisted(() => ({
  post: vi.fn(), permissions: [] as string[], employeeId: 99,
  mode: "ACTIVITY", status: "ARRIVED",
  completedAt: null as string | null | undefined,
  completedById: null as number | null | undefined,
  completedByUsername: null as string | null | undefined,
  completedByRole: null as string | null | undefined,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { employeeId: m.employeeId, isOwner: false, roles: [{ slug: "admin-gudang" }] } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({
  apiGet: async (url: string) => url.endsWith("/drops") ? null : {
    id: 10, transportCode: "TR-10", trackingMode: m.mode, transportMode: "DIRECT", status: m.status,
    origin: "A", destination: "B", vehicle: { id: 2, vehicleNumber: "BK-1" }, driver: { id: 1, name: "Driver" }, kenek: null,
    checkpoints: [], checkpointRecords: [], shipments: [], shipmentCount: 0, totalWeightKg: 0, totalVolumeM3: 0, totalPrice: 0,
    completedAt: m.completedAt, completedById: m.completedById,
    completedByUsername: m.completedByUsername, completedByRole: m.completedByRole,
  },
  apiPost: m.post, apiDelete: vi.fn(), hasPermission: (_user: unknown, permission: string) => m.permissions.includes(permission),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/app/transport-activities-panel", () => ({ TransportActivitiesPanel: () => null }));
vi.mock("@/components/app/transport-drops-panel", () => ({ TransportDropsPanel: () => null }));
vi.mock("@/components/app/transport-expenses-panel", () => ({ TransportExpensesPanel: () => null }));
vi.mock("@/components/app/transport-form-dialog", () => ({ TransportFormDialog: () => null }));
vi.mock("@/components/app/checkpoint-checkin-dialog", () => ({ CheckpointCheckinDialog: () => null }));
vi.mock("@/components/app/transport-manifest-print", () => ({ TransportManifestPrint: () => null }));
vi.mock("@/components/app/photo-detail-dialog", () => ({ PhotoDetailDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.employeeId = 99; m.mode = "ACTIVITY"; m.status = "ARRIVED";
  m.permissions = ["transport.complete"];
  m.completedAt = null; m.completedById = null; m.completedByUsername = null; m.completedByRole = null;
  m.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/arrive")) m.status = "ARRIVED";
    if (url.endsWith("/complete")) {
      m.status = "COMPLETED";
      m.completedAt = "2026-10-13T10:00:00Z";
      m.completedById = 7; m.completedByUsername = "reviewer.snapshot"; m.completedByRole = "admin-gudang";
    }
    return {};
  });
});

const auditButton = "Audit & Konfirmasi Completed";

describe("transport audit completion", () => {
  it("hides completion without its specific permission, even for assigned crew with arrival/approval permissions", async () => {
    m.employeeId = 1;
    m.permissions = ["transport.arrive", "transport.delivery.approve", "transport.expense.approve"];
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Transport tiba — menunggu audit.");
    expect(screen.queryByRole("button", { name: auditButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each(["PLANNED", "DEPARTED", "COMPLETED", "CANCELLED"])("does not offer audit completion for %s", async (status) => {
    m.status = status;
    render(<TransportDetailPage transportId={10} />);
    await screen.findByText("Informasi Transport");
    expect(screen.queryByRole("button", { name: auditButton })).not.toBeInTheDocument();
    expect(screen.queryByText("Transport tiba — menunggu audit.")).not.toBeInTheDocument();
  });

  it("marks arrival as ARRIVED awaiting audit, never automatically completes", async () => {
    m.employeeId = 1; m.status = "DEPARTED";
    m.permissions.push("transport.arrive");
    render(<TransportDetailPage transportId={10} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai Tiba" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ARRIVED dan menunggu audit, bukan COMPLETED");
    fireEvent.click(screen.getByRole("button", { name: "Ya, tandai tiba" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/arrive", {}));
    expect(await screen.findByRole("status")).toHaveTextContent("Status masih ARRIVED, belum COMPLETED.");
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Transport COMPLETED — audit dikonfirmasi.")).not.toBeInTheDocument();
  });

  it.each(["ACTIVITY", "CHECKPOINT"])("allows an unassigned permitted reviewer to confirm %s via the complete endpoint", async (mode) => {
    m.mode = mode;
    render(<TransportDetailPage transportId={10} />);
    fireEvent.click(await screen.findByRole("button", { name: auditButton }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("foto bukti perjalanan, shipment/paket, dan biaya operasional");
    expect(dialog).toHaveTextContent("Tidak ada approval paket atau biaya operasional otomatis");
    expect(m.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, konfirmasi audit" }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports/10/complete", {}));
    expect(m.post).toHaveBeenCalledTimes(1);
    const banner = await screen.findByRole("status");
    await waitFor(() => expect(banner).toHaveTextContent("Transport COMPLETED — audit dikonfirmasi."));
    expect(banner).toHaveTextContent("Reviewer: reviewer.snapshot · Role: admin-gudang");
    expect(banner).toHaveTextContent(formatDate("2026-10-13T10:00:00Z", true));
    expect(screen.queryByRole("button", { name: auditButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancels the audit without posting", async () => {
    render(<TransportDetailPage transportId={10} />);
    fireEvent.click(await screen.findByRole("button", { name: auditButton }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(m.post).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("menunggu audit");
  });

  it("displays the stored reviewer snapshot and audit timestamp without completion permission", async () => {
    m.status = "COMPLETED"; m.permissions = [];
    m.completedAt = "2026-10-13T10:00:00Z";
    m.completedById = 7; m.completedByUsername = "former.reviewer"; m.completedByRole = "owner";
    render(<TransportDetailPage transportId={10} />);
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Reviewer: former.reviewer · Role: owner");
    expect(banner).toHaveTextContent(formatDate(m.completedAt, true));
    expect(banner).toHaveTextContent("Approval paket dan biaya operasional tetap terpisah.");
  });

  it("handles legacy completed records without optional snapshot fields", async () => {
    m.status = "COMPLETED";
    m.completedAt = undefined; m.completedById = undefined; m.completedByUsername = undefined; m.completedByRole = undefined;
    render(<TransportDetailPage transportId={10} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Reviewer: - · Role: - · Waktu: -");
  });
});
