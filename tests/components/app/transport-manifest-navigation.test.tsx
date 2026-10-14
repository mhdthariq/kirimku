// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportDetailPage } from "@/components/app/pages/transport-detail-page";

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

describe("transport manifest navigation", () => {
  it("opens a dedicated manifest page instead of mounting a preview on transport detail", async () => {
    window.history.replaceState(null, "", "#/transports/10");
    render(<TransportDetailPage transportId={10} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cetak Manifest" }));
    expect(window.location.hash).toBe("#/transports/10/manifest");
    expect(document.querySelector("#manifest-print-portal")).toBeNull();
  });
});
