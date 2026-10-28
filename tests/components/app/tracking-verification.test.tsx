// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ params: new URLSearchParams(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => m.params }));
import TrackingPage from "@/app/tracking-paket/page";

beforeEach(() => { m.params = new URLSearchParams(); m.fetch.mockReset(); vi.stubGlobal("fetch", m.fetch); });
describe("tracking QR verification page", () => {
  it("shows scan instructions without search or verification inputs on a direct visit", () => {
    render(<TrackingPage />);
    expect(screen.getByText(/Scan kode QR pada Master Resi/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("does not fetch until the user submits their full phone and uses QR company identity", async () => {
    m.params = new URLSearchParams({ corporateId: "CORP-A", resi: "CHILD-1" });
    m.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "Nomor tidak sesuai" }) });
    render(<TrackingPage />);
    expect(m.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nomor telepon lengkap pengirim / penerima"), { target: { value: "081234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Verifikasi & Lacak" }));
    await waitFor(() => expect(m.fetch).toHaveBeenCalledWith("/api/v1/public/track/CHILD-1", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json", "x-corp-id": "CORP-A" }, body: JSON.stringify({ phone: "081234567890" }),
    })));
    expect(await screen.findByText("Nomor tidak sesuai")).toBeInTheDocument();
    expect(screen.queryByText("Master Resi", { exact: true })).not.toBeInTheDocument();
  });
  it("clears previous verification when navigating to another QR", () => {
    m.params = new URLSearchParams({ corporateId: "A", resi: "MKT-1" });
    const view = render(<TrackingPage />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "081234567890" } });
    m.params = new URLSearchParams({ corporateId: "B", resi: "MKT-2" });
    view.rerender(<TrackingPage />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
