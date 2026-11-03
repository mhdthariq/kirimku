import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/infrastructure/auth/auth";

const m = vi.hoisted(() => ({
  auth: vi.fn(), pickupList: vi.fn(), deliveryList: vi.fn(), pickupFind: vi.fn(), deliveryFind: vi.fn(),
  pickupUpdate: vi.fn(), deliveryUpdate: vi.fn(), scope: vi.fn(), inScope: vi.fn(), progress: vi.fn(), payment: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  pickup: { findMany: m.pickupList, findUnique: m.pickupFind, update: m.pickupUpdate },
  delivery: { findMany: m.deliveryList, findUnique: m.deliveryFind, update: m.deliveryUpdate },
  warehouse: { findMany: vi.fn().mockResolvedValue([]) },
} }));
vi.mock("@/infrastructure/auth/auth", async original => ({
  ...await original<typeof import("@/infrastructure/auth/auth")>(), getAuthUser: m.auth,
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit, diffFields: vi.fn().mockReturnValue({}) }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({
  assertShipmentScope: m.scope, inScope: m.inScope, scopeForUser: vi.fn().mockResolvedValue(null),
  cityIndex: vi.fn().mockResolvedValue([]), pickupGudangIds: () => [2], deliveryGudangIds: () => [2],
}));
vi.mock("@/infrastructure/services/scan-flow", () => ({ scanProgress: m.progress, paymentSummary: m.payment }));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));

import { GET as pickupList } from "@/app/api/v1/pickups/route";
import { GET as deliveryList } from "@/app/api/v1/deliveries/route";
import { GET as pickupGet, PUT as pickupPut } from "@/app/api/v1/pickups/[id]/route";
import { GET as deliveryGet, PUT as deliveryPut } from "@/app/api/v1/deliveries/[id]/route";
import { HttpError } from "@/shared/http-error";

const permissions = ["pickup.view", "pickup.assign_kurir", "delivery.view", "delivery.assign_kurir"];
const user: AuthUser = {
  id: 1, username: "staff", name: "Staff", isOwner: false, isActive: true,
  employeeId: 9, warehouseId: 2, warehouseName: "Depot", partnerId: null, partnerType: null,
  roles: [{ id: 1, slug: "admin-gudang", name: "Admin Gudang" }], permissions,
};
const capture = {
  photoUrl: "data:image/jpeg;base64,private-proof", locationLabel: "Private capture address",
  captureLatitude: -6.123456, captureLongitude: 106.123456, captureAccuracy: 3,
  capturedAt: new Date("2026-11-03T01:02:03Z"), timeZone: "Asia/Makassar", mockLocation: true,
};
const record = {
  id: 12, pickupCode: "PU-12", deliveryCode: "DLV-12", masterId: 20, kurirId: 9,
  status: "IN_PROGRESS", latitude: -7, longitude: 110, notes: "Existing note", proofOfDelivery: "Receiver",
  ...capture, scans: [], master: {
    id: 20, masterCode: "M-20", fulfillmentMode: "STANDARD", customer: { name: "Customer" }, details: [], _count: { details: 0 },
  },
};
const progress = { scanned: 0, total: 1, allScanned: false };
const endpoints = [
  { name: "pickup list GET", kind: "list", method: "GET", route: pickupList },
  { name: "delivery list GET", kind: "list", method: "GET", route: deliveryList },
  { name: "pickup detail GET", kind: "detail", method: "GET", route: pickupGet },
  { name: "delivery detail GET", kind: "detail", method: "GET", route: deliveryGet },
  { name: "pickup PUT", kind: "update", method: "PUT", route: pickupPut },
  { name: "delivery PUT", kind: "update", method: "PUT", route: deliveryPut },
];
const params = () => ({ params: Promise.resolve({ id: "12" }) });
function request(method: string) {
  return new NextRequest("http://localhost/api/v1/tasks/12", {
    method, ...(method === "PUT" ? { body: JSON.stringify({ notes: "Updated note" }), headers: { "content-type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue(user);
  m.pickupList.mockResolvedValue([record]); m.deliveryList.mockResolvedValue([record]);
  m.pickupFind.mockResolvedValue(record); m.deliveryFind.mockResolvedValue(record);
  m.pickupUpdate.mockResolvedValue({ ...record, notes: "Updated note" });
  m.deliveryUpdate.mockResolvedValue({ ...record, notes: "Updated note" });
  m.scope.mockResolvedValue(undefined); m.inScope.mockReturnValue(true);
  m.progress.mockResolvedValue(progress); m.payment.mockResolvedValue({ paid: 0 });
});

for (const endpoint of endpoints) describe(endpoint.name, () => {
  it("returns null photo and no capture metadata without proof permission, retaining planned coordinates", async () => {
    const response = await endpoint.route(request(endpoint.method), params());
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const row = endpoint.kind === "list" ? data[0] : data;
    expect(row).toMatchObject({ id: 12, photoUrl: null, latitude: -7, longitude: 110 });
    for (const field of Object.keys(capture).filter(field => field !== "photoUrl")) expect(row).not.toHaveProperty(field);
    expect(JSON.stringify(data)).not.toContain("private-proof");
    expect(JSON.stringify(data)).not.toContain("Private capture address");
    if (endpoint.name.startsWith("delivery")) expect(row.proofOfDelivery).toBe("Receiver");
    if (endpoint.kind === "detail") expect(row.progress).toEqual(progress);
    if (endpoint.kind === "update") {
      const update = endpoint.name.startsWith("pickup") ? m.pickupUpdate : m.deliveryUpdate;
      expect(update).toHaveBeenCalledWith({ where: { id: 12 }, data: { notes: "Updated note" } });
      expect(row.notes).toBe("Updated note");
    }
    expect(record).toMatchObject(capture);
  });

  it.each([
    { name: "explicit permission", actor: { ...user, permissions: [...permissions, "proof_photo.view"] } },
    { name: "owner", actor: { ...user, isOwner: true, permissions: [] } },
    { name: "wildcard", actor: { ...user, permissions: ["*"] } },
  ])("preserves photos for $name", async ({ actor }) => {
    m.auth.mockResolvedValue(actor);
    const response = await endpoint.route(request(endpoint.method), params());
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const row = endpoint.kind === "list" ? data[0] : data;
    expect(row).toMatchObject({ photoUrl: capture.photoUrl, latitude: -7, longitude: 110 });
    if (endpoint.kind !== "list") expect(row).toMatchObject({ ...capture, capturedAt: capture.capturedAt.toISOString() });
  });

  it("retains authentication and route permission checks", async () => {
    m.auth.mockResolvedValue(null);
    expect((await endpoint.route(request(endpoint.method), params())).status).toBe(401);
    m.auth.mockResolvedValue({ ...user, permissions: ["proof_photo.view"] });
    expect((await endpoint.route(request(endpoint.method), params())).status).toBe(403);
    expect(m.pickupList).not.toHaveBeenCalled(); expect(m.deliveryList).not.toHaveBeenCalled();
    expect(m.pickupFind).not.toHaveBeenCalled(); expect(m.deliveryFind).not.toHaveBeenCalled();
  });

  it("retains warehouse scope checks", async () => {
    m.scope.mockRejectedValue(new HttpError(403, "Outside warehouse scope")); m.inScope.mockReturnValue(false);
    const response = await endpoint.route(request(endpoint.method), params());
    if (endpoint.kind === "list") expect((await response.json()).data).toEqual([]);
    else expect(response.status).toBe(403);
    expect(m.pickupUpdate).not.toHaveBeenCalled(); expect(m.deliveryUpdate).not.toHaveBeenCalled();
  });
});

it.each([
  { route: pickupList, find: m.pickupList }, { route: deliveryList, find: m.deliveryList },
])("keeps the existing executor assignment filter", async ({ route, find }) => {
  m.auth.mockResolvedValue({ ...user, permissions: ["pickup.view", "delivery.view", "proof_photo.view"] });
  expect((await route(request("GET"))).status).toBe(200);
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kurirId: user.employeeId }) }));
});
