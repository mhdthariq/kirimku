// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportManifestPrint } from "../../../src/components/app/transport-manifest-print";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet, apiPost: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

const transport = {
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

beforeEach(() => { apiGet.mockReset(); });

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
