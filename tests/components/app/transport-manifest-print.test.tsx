// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportManifestPrint } from "../../../src/components/app/transport-manifest-print";

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet, apiPost }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

const transport = {
  id: 1,
  transportCode: "TR-001",
  status: "PLANNED",
  routeName: null,
  checkpoints: [],
  origin: "Medan",
  destination: "Binjai",
  vehicle: { vehicleNumber: "BK 1234", name: null },
  driver: null,
  kenek: null,
  plannedDepartureAt: null,
  plannedArrivalAt: null,
  shipments: [],
  shipmentCount: 0,
  totalWeightKg: 0,
  totalVolumeM3: 0,
  totalPrice: null,
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({});
  document.title = "KirimKu";
});

describe("TransportManifestPrint mode", () => {
  it("uses the drops API mode, even when transport detail has no checkpoints or mode", async () => {
    apiGet.mockImplementation(async (path: string) => path.endsWith("/drops")
      ? { transportMode: "MULTI_DROP" }
      : transport);
    render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
    expect(await screen.findByText("MULTI_DROP")).toBeInTheDocument();
    expect(screen.queryByText("DIRECT")).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/transports/1/drops");
  });

  it("keeps the manifest available without inventing a mode when the drops request fails", async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith("/drops")) throw new Error("Unavailable");
      return transport;
    });
    render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("TR-001").length).toBeGreaterThan(0));
    expect(screen.queryByText("DIRECT")).not.toBeInTheDocument();
    expect(screen.getByText("Mode").parentElement).toHaveTextContent("—");
  });
});

describe("manifest print document", () => {
  it("uses the transport code as the document/PDF title and restores the previous title on exit", async () => {
    apiGet.mockResolvedValue(transport);
    const { unmount } = render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(document.title).toBe("Manifest TR-001"));
    unmount();
    expect(document.title).toBe("KirimKu");
  });

  it("prints with the dynamic title and preserves fire-and-forget audit logging", async () => {
    apiGet.mockResolvedValue(transport);
    apiPost.mockRejectedValue(new Error("Audit unavailable"));
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.title).toBe("Manifest TR-001");
    });
    const onClose = vi.fn();
    render(<TransportManifestPrint transportId={1} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cetak / Simpan PDF" }));
    expect(apiPost).toHaveBeenCalledWith("/transports/1/print-log", {});
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("disables printing while loading and when the transport cannot be loaded", async () => {
    apiGet.mockRejectedValue(new Error("Unavailable"));
    render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeDisabled();
    expect(await screen.findByText("Transport tidak ditemukan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeDisabled();
    expect(document.title).toBe("KirimKu");
  });

  it("assigns an A4 portrait page and keeps the manifest visible in the shared print stylesheet", async () => {
    apiGet.mockResolvedValue(transport);
    render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
    await screen.findByText("Manifest Transport / Surat Jalan");
    const styles = document.querySelector("#manifest-print-portal")?.previousElementSibling?.textContent;
    expect(styles).toContain("@page manifest-page { size: A4 portrait; margin: 12mm; }");
    expect(styles).toContain("page: manifest-page;");
    expect(styles).toContain("width: 100% !important");
    const globalCss = readFileSync("src/app/globals.css", "utf8");
    expect(globalCss).toContain("body > *:not(#resi-print-portal):not(#invoice-print-portal):not(#manifest-print-portal)");
  });
});
