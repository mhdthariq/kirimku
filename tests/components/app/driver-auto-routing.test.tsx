// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DriverDashboard, selectDriverTransport, type DriverTransportSummary } from "@/components/app/pages/driver-dashboard-page";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { name: "Driver One" } }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/app/checkpoint-checkin-dialog", () => ({ CheckpointCheckinDialog: () => null }));
vi.mock("@/components/app/date-period-filter", () => ({ DatePeriodFilter: () => null }));
const summary = (id: number, status: string, plannedDepartureAt: string | null = null) => ({ id, status, plannedDepartureAt }) as DriverTransportSummary;
const empty = { current: null, upcoming: [], future: [], completedCount: 0, history: [], totalTransportsAllTime: 0 };
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, "", "#/driver-dashboard"); });

describe("driver assigned transport routing", () => {
  it("prioritizes DEPARTED over PLANNED", () => {
    const departed = summary(1, "DEPARTED");
    expect(selectDriverTransport({ current: departed, upcoming: [summary(2, "PLANNED", "2026-10-13T10:00:00Z")], future: [] })).toBe(departed);
  });
  it("chooses nearest planned departure across upcoming and future with null dates last", () => {
    expect(selectDriverTransport({ current: summary(99, "ARRIVED"), upcoming: [summary(2, "PLANNED", null)], future: [summary(3, "PLANNED", "2026-10-14T10:00:00Z"), summary(4, "PLANNED", "2026-10-13T10:00:00Z"), summary(5, "CANCELLED", "2026-10-12T10:00:00Z")] })?.id).toBe(4);
    expect(selectDriverTransport(empty)).toBeNull();
  });
  it("replaces dashboard history with the active assignment", async () => {
    m.get.mockResolvedValue({ ...empty, current: summary(7, "DEPARTED") });
    const length = window.history.length;
    render(<DriverDashboard />);
    await waitFor(() => expect(window.location.hash).toBe("#/transports/7"));
    expect(window.history.length).toBe(length);
  });
  it("routes to the next planned assignment when no trip is active", async () => {
    m.get.mockResolvedValue({ ...empty, upcoming: [summary(8, "PLANNED", "2026-10-13T10:00:00Z")] });
    render(<DriverDashboard />);
    await waitFor(() => expect(window.location.hash).toBe("#/transports/8"));
  });
  it("keeps the normal dashboard fallback without an assignment", async () => {
    m.get.mockResolvedValue(empty);
    render(<DriverDashboard />);
    expect(await screen.findByText("Tidak ada transport yang sedang berjalan.")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/driver-dashboard");
  });
  it("shows errors instead of an endless skeleton and supports retry", async () => {
    m.get.mockRejectedValueOnce(new Error("Network failure")).mockResolvedValue(empty);
    render(<DriverDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network failure");
    expect(window.location.hash).toBe("#/driver-dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Tidak ada transport yang sedang berjalan.")).toBeInTheDocument();
  });
});
