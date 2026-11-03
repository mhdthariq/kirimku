import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  taskFind: vi.fn(), taskUpdate: vi.fn(), taskReset: vi.fn(),
  transportFind: vi.fn(), transportCreate: vi.fn(), transportDelete: vi.fn(),
  routeCreate: vi.fn(), checkpointCreate: vi.fn(), shipmentUpdate: vi.fn(),
}));
vi.mock("@/composition/api-helpers", () => ({
  guard: vi.fn().mockResolvedValue({ id: 7 }),
  dateOrNull: (value: string) => value ? new Date(value) : null,
  ok: (data: unknown) => Response.json({ data }),
  fail: (status: number, message: string) => Response.json({ message }, { status }),
  handle: async (_req: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => {
  const tx = {
    returnTask: { findUnique: m.taskFind, update: m.taskUpdate, updateMany: m.taskReset },
    transport: { findUnique: m.transportFind, create: m.transportCreate, delete: m.transportDelete },
    route: { create: m.routeCreate },
    checkpoint: { create: m.checkpointCreate },
    masterShipment: { update: m.shipmentUpdate },
  };
  return { db: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/infrastructure/auth/auth", () => ({ hasPermission: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: vi.fn(), diffFields: vi.fn() }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: vi.fn().mockResolvedValue("TRP-1") }));
vi.mock("@/infrastructure/services/transport-totals", () => ({}));
vi.mock("@/infrastructure/services/settings", () => ({}));
vi.mock("@/infrastructure/services/business-rules/shipment-transport", () => ({}));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertTransportScope: vi.fn() }));
vi.mock("@/infrastructure/services/transport-crew", () => ({}));
vi.mock("@/infrastructure/services/transport-warehouse-staff", () => ({}));

import { POST } from "@/app/api/v1/return-tasks/[id]/create-transport/route";
import { GET } from "@/app/api/v1/return-tasks/[id]/route";
import { DELETE } from "@/app/api/v1/transports/[id]/route";

const params = { params: Promise.resolve({ id: "10" }) };
const checkpoints = [1, 2, 3].map((sequence) => ({
  name: `Stop ${sequence}`, sequence, latitude: sequence, longitude: sequence,
  radiusMeters: 100,
}));
function task(trackingMode = "CHECKPOINT", stops = checkpoints) {
  return {
    id: 10, returnTaskCode: "RT-10", status: "APPROVED", returnTransportId: null,
    vehicleId: 2, driverId: 8, origin: "B", destination: "A",
    originalTransport: { trackingMode, kenekId: 9, route: { name: "A-B", checkpoints: stops } },
  };
}
function create() {
  return POST(new NextRequest("http://localhost/api/v1/return-tasks/10/create-transport", {
    method: "POST", body: JSON.stringify({}),
  }), params);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.taskFind.mockResolvedValue(task());
  m.routeCreate.mockResolvedValue({ id: 3 });
  m.transportCreate.mockImplementation(async ({ data }) => ({ id: 20, ...data }));
  m.taskUpdate.mockImplementation(async ({ data }) => ({ ...task(), ...data }));
  m.transportFind.mockResolvedValue({ id: 20, status: "PLANNED", transportCode: "TRP-1", route: null, shipments: [] });
});

describe("Tugas Balik return transport lifecycle", () => {
  it("inherits ACTIVITY tracking without requiring or creating checkpoints", async () => {
    m.taskFind.mockResolvedValue(task("ACTIVITY", []));
    expect((await create()).status).toBe(200);
    expect(m.checkpointCreate).not.toHaveBeenCalled();
    expect(m.transportCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      trackingMode: "ACTIVITY", transportMode: "DIRECT", origin: "B", destination: "A",
      vehicleId: 2, driverId: 8, kenekId: 9,
    }) });
  });

  it("does not copy unused checkpoints from an ACTIVITY route", async () => {
    m.taskFind.mockResolvedValue(task("ACTIVITY"));
    expect((await create()).status).toBe(200);
    expect(m.checkpointCreate).not.toHaveBeenCalled();
    const preview = await GET(new NextRequest("http://localhost/api/v1/return-tasks/10"), params);
    expect((await preview.json()).data.returnCheckpoints).toEqual([]);
  });

  it("preserves CHECKPOINT tracking and reverses the route", async () => {
    expect((await create()).status).toBe(200);
    expect(m.transportCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ trackingMode: "CHECKPOINT" }) });
    expect(m.checkpointCreate.mock.calls.map(([{ data }]) => [data.name, data.sequence])).toEqual([
      ["Stop 3", 1], ["Stop 2", 2], ["Stop 1", 3],
    ]);
  });

  it("still rejects checkpoint routes with fewer than three stops", async () => {
    m.taskFind.mockResolvedValue(task("CHECKPOINT", checkpoints.slice(0, 2)));
    expect((await create()).status).toBe(422);
    expect(m.transportCreate).not.toHaveBeenCalled();
  });

  it("resets the linked task to APPROVED before deleting, allowing recreation", async () => {
    m.taskReset.mockImplementation(async ({ data }) => {
      m.taskFind.mockResolvedValue({ ...task(), ...data });
      return { count: 1 };
    });
    const response = await DELETE(new NextRequest("http://localhost/api/v1/transports/10", { method: "DELETE" }), params);
    expect(response.status).toBe(200);
    expect(m.taskReset).toHaveBeenCalledWith({
      where: { returnTransportId: 20 }, data: { returnTransportId: null, status: "APPROVED" },
    });
    expect(m.taskReset.mock.invocationCallOrder[0]).toBeLessThan(m.transportDelete.mock.invocationCallOrder[0]);
    expect((await create()).status).toBe(200);
    expect(m.taskUpdate).toHaveBeenCalledWith({ where: { id: 10 }, data: { returnTransportId: 20, status: "PLANNED" } });
  });

  it("does not reset tasks when deletion is forbidden for a departed transport", async () => {
    m.transportFind.mockResolvedValue({ id: 20, status: "DEPARTED", route: null, shipments: [] });
    expect((await DELETE(new NextRequest("http://localhost/api/v1/transports/10", { method: "DELETE" }), params)).status).toBe(422);
    expect(m.taskReset).not.toHaveBeenCalled();
    expect(m.transportDelete).not.toHaveBeenCalled();
  });
});
