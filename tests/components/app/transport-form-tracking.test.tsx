// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportFormDialog } from "@/components/app/transport-form-dialog";

const m = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({
  apiGet: async (url: string) => url === "/options" ? { routes: [{ id: 1, name: "Route", origin: "A", destination: "B" }], vehicles: [{ id: 2, vehicleNumber: "BK-1" }], employees: [] } : [],
  apiPost: m.post, apiPut: m.put, employeesByPosition: () => [],
}));
vi.mock("@/components/app/capacity-status-card", () => ({ TransportFormCapacityPreview: () => null }));
vi.mock("@/components/app/form-parts", () => ({
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => <label>{label}{children}</label>,
  FormSelect: ({ value, onValueChange, options, disabled }: { value: string; onValueChange: (v: string) => void; options: { value: string; label: string }[]; disabled: boolean }) => <select value={value} onChange={(e) => onValueChange(e.target.value)} disabled={disabled}><option value="">Pilih</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>,
  SubmitButton: ({ children, busy }: { children: React.ReactNode; busy: boolean }) => <button type="submit" disabled={busy}>{children}</button>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); m.post.mockResolvedValue({}); });
async function fillPlan() {
  await screen.findByRole("option", { name: "Route" });
  fireEvent.change(screen.getByLabelText("Rute"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Kendaraan"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Rencana Berangkat"), { target: { value: "2026-10-13T08:00" } });
  fireEvent.change(screen.getByLabelText("Rencana Tiba"), { target: { value: "2026-10-13T09:00" } });
}
function submit() { fireEvent.submit(screen.getByLabelText("Rencana Tiba").closest("form")!); }

describe("transport creation tracking modes", () => {
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
