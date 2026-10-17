import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transportCreate: vi.fn(), pickupCreate: vi.fn(), pickups: [] as { pickupCode: string }[],
  shipmentIds: [20, 21],
}));
vi.mock("@/composition/api-helpers", async () => ({
  guard: vi.fn().mockResolvedValue({ id: 7 }),
  num: (v: unknown) => v == null ? null : Number(v),
  str: (v: unknown) => typeof v === "string" ? v : null,
  dateOrNull: (v: string) => v ? new Date(v) : null,
  ok: (data: unknown) => Response.json({ data }),
  fail: (status: number, message: string) => Response.json({ message }, { status }),
  handle: async (_req: unknown, fn: () => Promise<Response>) => {
    try { return await fn(); } catch (error) {
      return Response.json({ message: (error as Error).message }, { status: 500 });
    }
  },
}));
vi.mock("@/infrastructure/persistence/db", () => {
  const tx = {
    transport: { create: m.transportCreate },
    transportShipment: { createMany: vi.fn() },
    masterShipment: { updateMany: vi.fn() },
    employee: { findUnique: vi.fn().mockResolvedValue({ name: "Driver" }) },
    pickup: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(async () => [...m.pickups]),
      create: m.pickupCreate,
    },
    trackingEvent: { create: vi.fn() },
  };
  return { db: {
    // Global reads cannot see the new pickups until the transaction commits.
    transport: { findMany: vi.fn().mockResolvedValue([]) },
    pickup: { findMany: vi.fn().mockResolvedValue([]) },
    route: { findUnique: vi.fn().mockResolvedValue({ id: 1, name: "A-B", checkpoints: [{}, {}, {}] }) },
    vehicle: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", vehicleNumber: "BK-1" }) },
    masterShipment: { findMany: vi.fn(async () => m.shipmentIds.map((id) => ({ id, masterCode: `RES-${id}`, fulfillmentMode: "DIRECT", status: "CREATED" }))) },
    trackingEvent: { create: vi.fn() },
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } };
});
vi.mock("@/infrastructure/services/audit", () => ({ audit: vi.fn() }));
vi.mock("@/infrastructure/services/transport-crew", () => ({ findActiveCrewAssignment: vi.fn().mockResolvedValue(null), crewAssignmentMessage: vi.fn() }));
vi.mock("@/infrastructure/services/business-rules/shipment-transport", () => ({ checkVehicleAvailable: vi.fn().mockResolvedValue(null), checkShipmentNotOnActiveTransport: vi.fn().mockResolvedValue(null) }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({}));
vi.mock("@/infrastructure/services/transport-totals", () => ({}));
vi.mock("@/infrastructure/services/settings", () => ({}));
import { POST } from "@/app/api/v1/transports/route";

beforeEach(() => {
  vi.clearAllMocks();
  m.pickups.length = 0;
  m.transportCreate.mockResolvedValue({ id: 10, transportCode: "TRP-2026-000001" });
  m.pickupCreate.mockImplementation(async ({ data }) => {
    if (m.pickups.some((p) => p.pickupCode === data.pickupCode)) throw new Error("Unique constraint failed: pickupCode");
    m.pickups.push(data);
    return data;
  });
});

describe("transport creation with DIRECT shipments", () => {
  it("allocates distinct pickup codes for two shipments within one transaction", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/transports", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ routeId: 1, vehicleId: 2, driverId: 8, shipmentIds: [20, 21], plannedDepartureAt: "2026-10-17T08:00:00Z", plannedArrivalAt: "2026-10-17T09:00:00Z" }),
    }));
    expect(await response.clone().json()).not.toHaveProperty("message", "Unique constraint failed: pickupCode");
    expect(response.status).toBe(200);
    expect(m.pickups.map((p) => p.pickupCode)).toEqual(["PICK-2026-000001", "PICK-2026-000002"]);
  });
});
