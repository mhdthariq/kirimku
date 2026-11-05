// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";
import type { Options, Transport } from "@/infrastructure/http/client-api";

const m = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), routes: [{ id: 1, name: "Route", origin: "A", destination: "B" }] as Options["routes"] }));
vi.mock("@/infrastructure/http/client-api", () => ({
  apiGet: async (url: string) => url === "/options" ? { routes: m.routes, vehicles: [{ id: 2, vehicleNumber: "BK-1" }], employees: [{ id: 8, name: "Budi Gudang", position: "Gudang" }] } : url.startsWith("/shipments") ? [] : { shipments: [], driver: null, kenek: { id: 9 }, warehouseStaff: { id: 8 } },
  apiPost: m.post, apiPut: m.put, employeesByPosition: () => [{ id: 8, name: "Budi Gudang" }],
}));
vi.mock("@/components/app/capacity-status-card", () => ({ TransportFormCapacityPreview: () => null }));
vi.mock("@/components/app/form-parts", () => ({
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => <label>{label}{children}</label>,
  FormSelect: ({ value, onValueChange, options, disabled }: { value: string; onValueChange: (v: string) => void; options: { value: string; label: string }[]; disabled: boolean }) => <select value={value} onChange={(e) => onValueChange(e.target.value)} disabled={disabled}><option value="">Pilih</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>,
  SubmitButton: ({ children, busy }: { children: React.ReactNode; busy: boolean }) => <button type="submit" disabled={busy}>{children}</button>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); m.post.mockResolvedValue({}); m.routes = [{ id: 1, name: "Route", origin: "A", destination: "B" }]; });
async function fillPlan() {
  await screen.findByRole("option", { name: "Route" });
  fireEvent.change(screen.getByLabelText("Rute"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Kendaraan"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Rencana Berangkat"), { target: { value: "2026-10-13T08:00" } });
  fireEvent.change(screen.getByLabelText("Rencana Tiba"), { target: { value: "2026-10-13T09:00" } });
}
function submit() { fireEvent.submit(screen.getByLabelText("Rencana Tiba").closest("form")!); }

describe("transport creation tracking modes", () => {
  it("shows one choice for existing identical Balik routes", async () => {
    m.routes = [1, 2].map((id) => ({ id, name: "Route (Balik)", origin: "B", destination: "A" }));
    render(<TransportFormDialog open editing={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("option", { name: "Route (Balik)" });
    expect(screen.getAllByRole("option", { name: "Route (Balik)" })).toHaveLength(1);
  });

  it("keeps Balik routes with different checkpoints selectable", async () => {
    m.routes = [1, 2].map((id) => ({ id, name: "Route (Balik)", origin: "B", destination: "A", checkpoints: [
      { name: "Stop", sequence: 1, latitude: id, longitude: 1, radiusMeters: 100 },
    ] }));
    render(<TransportFormDialog open editing={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Route (Balik)" })).toHaveLength(2));
  });

  it("preserves the selected duplicate route when editing an existing transport", async () => {
    m.routes = [1, 2].map((id) => ({ id, name: "Route (Balik)", origin: "B", destination: "A" }));
    const editing = { id: 10, routeId: 2, vehicleId: 2, trackingMode: "ACTIVITY" } as Transport;
    render(<TransportFormDialog open editing={editing} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole("option", { name: "Route (Balik)" });
    expect(screen.getByLabelText("Rute")).toHaveValue("2");
    expect(screen.getAllByRole("option", { name: "Route (Balik)" })).toHaveLength(1);
  });

  it("saves selected warehouse staff and allows transport without a Kenek", async () => {
    render(<TransportFormDialog open editing={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await fillPlan();
    fireEvent.change(screen.getByLabelText(/Petugas Gudang/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Kenek/), { target: { value: "none" } });
    submit();
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports", expect.objectContaining({ warehouseStaffId: 8, kenekId: null })));
  });
  it("creates activity mode independently from DIRECT transport mode", async () => {
    const saved = vi.fn();
    render(<TransportFormDialog open editing={null} onOpenChange={vi.fn()} onSaved={saved} />);
    await fillPlan();
    expect(screen.getByRole("option", { name: "Activity Tracking (Tanpa Checkpoint)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mode Tracking"), { target: { value: "ACTIVITY" } });
    submit();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(m.post).toHaveBeenCalledWith("/transports", expect.objectContaining({ trackingMode: "ACTIVITY", transportMode: "DIRECT", routeId: 1, origin: "A", destination: "B" }));
  });
  it("defaults to checkpoint and preserves activity when Multi Drop is selected", async () => {
    render(<TransportFormDialog open editing={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await fillPlan();
    expect(screen.getByLabelText("Mode Tracking")).toHaveValue("CHECKPOINT");
    fireEvent.change(screen.getByLabelText("Mode Tracking"), { target: { value: "ACTIVITY" } });
    fireEvent.change(screen.getByLabelText("Mode Transport"), { target: { value: "MULTI_DROP" } });
    expect(screen.getByLabelText("Mode Tracking")).not.toBeDisabled();
    expect(screen.getByLabelText("Mode Tracking")).toHaveValue("ACTIVITY");
    expect(screen.getByRole("option", { name: "Activity Tracking (Tanpa Checkpoint)" })).toBeInTheDocument();
    submit();
    await waitFor(() => expect(m.post).toHaveBeenCalledWith("/transports", expect.objectContaining({ trackingMode: "ACTIVITY", transportMode: "MULTI_DROP" })));
  });
});
