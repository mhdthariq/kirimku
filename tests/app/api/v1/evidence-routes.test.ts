import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(), permission: vi.fn(), metadata: vi.fn(), stamp: vi.fn(), scope: vi.fn(),
  transport: vi.fn(), pickup: vi.fn(), delivery: vi.fn(), employee: vi.fn(), progress: vi.fn(), assignment: vi.fn(),
  checkpoint: vi.fn(), createCheckpoint: vi.fn(), createExpense: vi.fn(), updatePickup: vi.fn(), updateDelivery: vi.fn(),
  updateTransport: vi.fn(), updateShipment: vi.fn(), tracking: vi.fn(), audit: vi.fn(), code: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/infrastructure/services/evidence-photo", () => ({ parseEvidenceMetadata: m.metadata }));
vi.mock("@/infrastructure/services/activity-watermark", () => ({ watermarkActivityPhoto: m.stamp }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  transport: { findUnique: m.transport, update: m.updateTransport },
  pickup: { findUnique: m.pickup, update: m.updatePickup },
  delivery: { findUnique: m.delivery }, employee: { findUnique: m.employee },
  checkpointRecord: { findFirst: m.checkpoint }, transportExpense: { create: m.createExpense },
  masterShipment: { update: m.updateShipment }, trackingEvent: { create: m.tracking }, $transaction: m.transaction,
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: m.permission }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: m.code }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: m.scope,
  cityIndex: vi.fn(), shipmentDestinationGudangIds: vi.fn() }));
vi.mock("@/infrastructure/services/scan-flow", () => ({ assertKurirAssignment: m.assignment, scanProgress: m.progress }));
vi.mock("@/infrastructure/services/transport-ops-server", async (original) => ({
  ...await original<typeof import("@/infrastructure/services/transport-ops-server")>(),
  assertTransportAccess: m.scope, syncReturnTaskForTransport: vi.fn(),
}));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));

import { POST as checkin } from "@/app/api/v1/transports/[id]/checkins/route";
import { POST as expense } from "@/app/api/v1/transports/[id]/expenses/route";
import { POST as pickup } from "@/app/api/v1/pickups/[id]/confirm/route";
import { POST as delivery } from "@/app/api/v1/deliveries/[id]/complete/route";

const photo = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer()).toString("base64")}`;
const metadata = { locationLabel: "Depot", timeZone: "Asia/Makassar", capturedAt: new Date("2026-11-03T01:02:03Z"), mockLocation: false };
const gps = { latitude: -6.2, longitude: 106.8, locationAccuracy: 5 };
const actor = { id: 7, name: "Confirming crew", employeeId: 8, isOwner: false, permissions: [] };
const master = { id: 20, origin: "Origin", destination: "Destination", status: "READY_FOR_PICKUP", fulfillmentMode: "STANDARD",
  details: [{ detailCode: "PKG-1" }], customer: { name: "Customer", type: "b2c" }, invoiceLines: [] };
const transport = { id: 10, transportCode: "TR-10", status: "DEPARTED", driverId: 8, kenekId: 9,
  driver: { name: "Assigned driver" }, vehicle: { vehicleNumber: "B 1234 XY", name: "Box truck" },
  origin: "Origin", destination: "Destination", shipments: [{ master }], trackingMode: "CHECKPOINT",
  route: { checkpoints: [{ id: 1, name: "Depot", isActive: true, sequence: 1, ...gps, radiusMeters: 100 }, { id: 2, sequence: 2 }] } };
const params = () => ({ params: Promise.resolve({ id: "10" }) });
const req = (body: unknown) => new NextRequest("http://localhost/api/v1/evidence", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const cases = [
  { name: "checkin", route: checkin, body: { checkpointId: 1, photo, ...gps }, write: m.createCheckpoint },
  { name: "expense", route: expense, body: { type: "BBM", amount: 100, photo, ...gps }, write: m.createExpense },
  { name: "pickup", route: pickup, body: { photoUrl: photo, ...gps }, write: m.updatePickup },
  { name: "delivery", route: delivery, body: { proofOfDelivery: "Receiver", photoUrl: photo, ...gps }, write: m.updateDelivery },
];

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(actor); m.permission.mockReturnValue(true);
  m.metadata.mockReturnValue({ metadata }); m.stamp.mockResolvedValue("stamped-photo");
  m.transport.mockResolvedValue(transport); m.employee.mockResolvedValue({ name: "Assigned courier" });
  m.pickup.mockResolvedValue({ id: 10, masterId: 20, master, status: "ASSIGNED", pickupCode: "PU-10", kurirId: 8,
    latitude: -7.5, longitude: 110.2 });
  m.delivery.mockResolvedValue({ id: 10, masterId: 20, master, status: "ASSIGNED", deliveryCode: "DLV-10", kurirId: 8,
    latitude: -7.5, longitude: 110.2 });
  m.progress.mockResolvedValue({ allScanned: true, total: 1, scanned: 1, details: [] });
  m.code.mockResolvedValue("EXP-10");
  m.createCheckpoint.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  m.createExpense.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  m.updatePickup.mockImplementation(async ({ data }) => ({ id: 10, ...data }));
  m.updateDelivery.mockImplementation(async ({ data }) => ({ id: 10, ...data }));
  m.transaction.mockImplementation(async fn => fn({ checkpointRecord: { create: m.createCheckpoint },
    transport: { update: m.updateTransport }, delivery: { update: m.updateDelivery },
    masterShipment: { update: m.updateShipment }, trackingEvent: { create: m.tracking } }));
});

for (const testCase of cases) describe(`${testCase.name} evidence integration`, () => {
  it("validates metadata, stamps the existing photo, and persists parsed capture fields", async () => {
    const body = { ...testCase.body, ...metadata, capturedAt: metadata.capturedAt.toISOString(), driverName: "Forged" };
    expect((await testCase.route(req(body), params())).status).toBe(200);
    expect(m.metadata).toHaveBeenCalledWith(body);
    expect(m.stamp).toHaveBeenCalledWith(photo, expect.objectContaining({ ...metadata,
      latitude: gps.latitude, longitude: gps.longitude, locationAccuracy: gps.locationAccuracy,
      origin: "Origin", destination: "Destination",
      recordedBy: actor.name, shipmentCount: 1,
    }), ...(testCase.name === "expense" ? [Math.floor(10 * 1024 * 1024 / 8)] : []));
    const captureOnly = testCase.name === "pickup" || testCase.name === "delivery";
    expect(testCase.write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      ...metadata, photoUrl: "stamped-photo",
      ...(captureOnly
        ? { captureLatitude: gps.latitude, captureLongitude: gps.longitude, captureAccuracy: gps.locationAccuracy }
        : gps),
    }) }));
    if (captureOnly) {
      const data = testCase.write.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("latitude"); expect(data).not.toHaveProperty("longitude");
    }
    expect(m.stamp.mock.calls[0][1].driverName).not.toBe("Forged");
  });
  it.each(["timeZone", "capturedAt", "locationLabel", "mockLocation", "locationAccuracy"])("rejects helper validation errors for %s before mutations", async field => {
    m.metadata.mockReturnValue({ error: `Invalid ${field}` });
    const response = await testCase.route(req({ ...testCase.body, [field]: "invalid" }), params());
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe(`Invalid ${field}`);
    expect(testCase.write).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
    expect(m.code).not.toHaveBeenCalled(); expect(m.stamp).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("returns 422 for watermark/decode failure without mutations", async () => {
    m.stamp.mockRejectedValue(new Error("Corrupt image"));
    const response = await testCase.route(req(testCase.body), params());
    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain("Foto bukti");
    expect(testCase.write).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});

for (const testCase of cases.filter(c => c.name !== "checkin")) describe(`${testCase.name} legacy capture`, () => {
  const { latitude: _lat, longitude: _lng, locationAccuracy: _accuracy, ...body } = testCase.body;
  it("accepts no GPS, retains the original photo, and does not invent coordinates", async () => {
    // Even assigned task coordinates must not be treated as a capture GPS fix.
    m.pickup.mockResolvedValue({ id: 10, masterId: 20, master, status: "ASSIGNED", ...gps });
    m.delivery.mockResolvedValue({ id: 10, masterId: 20, master, status: "ASSIGNED", ...gps });
    expect((await testCase.route(req(body), params())).status).toBe(200);
    expect(m.stamp).not.toHaveBeenCalled();
    const data = testCase.write.mock.calls[0][0].data;
    expect(data.photoUrl).toBe(photo);
    expect(data.latitude).toBeUndefined(); expect(data.longitude).toBeUndefined();
    if (testCase.name === "pickup" || testCase.name === "delivery") {
      expect(data).toMatchObject({ captureLatitude: null, captureLongitude: null, captureAccuracy: null });
      expect(data).not.toHaveProperty("latitude"); expect(data).not.toHaveProperty("longitude");
    }
    expect(data).toMatchObject(metadata);
  });
  it("rejects corrupt images even without GPS", async () => {
    const response = await testCase.route(req({ ...body, photo: "data:image/png;base64,YQ==", photoUrl: "data:image/png;base64,YQ==" }), params());
    expect(response.status).toBe(422); expect(testCase.write).not.toHaveBeenCalled();
  });
  it("rejects partial GPS without stamping or writing", async () => {
    expect((await testCase.route(req({ ...body, latitude: -6.2 }), params())).status).toBe(422);
    expect(m.stamp).not.toHaveBeenCalled(); expect(testCase.write).not.toHaveBeenCalled();
  });
});

for (const testCase of cases.filter(c => c.name !== "expense")) describe(`${testCase.name} capture accuracy`, () => {
  it.each([undefined, null, 0, 12.5])("persists and stamps optional accuracy %s", async locationAccuracy => {
    expect((await testCase.route(req({ ...testCase.body, locationAccuracy }), params())).status).toBe(200);
    expect(m.stamp).toHaveBeenCalledWith(photo, expect.objectContaining({ locationAccuracy: locationAccuracy ?? null }));
    expect(testCase.write.mock.calls[0][0].data).toMatchObject({
      [testCase.name === "checkin" ? "locationAccuracy" : "captureAccuracy"]: locationAccuracy ?? null,
    });
  });
});

it("stamps every expense photo and the legacy receipt before generating a code", async () => {
  const second = photo.replace("image/png", "image/jpeg");
  m.stamp.mockImplementation(async (url: string) => `stamped:${url}`);
  expect((await expense(req({ type: "BBM", amount: 100, photo, photos: [photo, second], ...gps }), params())).status).toBe(200);
  expect(m.stamp).toHaveBeenCalledTimes(3);
  expect(m.createExpense).toHaveBeenCalledWith({ data: expect.objectContaining({ photoUrl: `stamped:${photo}`, photoUrls: [`stamped:${photo}`, `stamped:${second}`] }) });
});

it("adds server-derived vehicle and driver context to checkpoint evidence", async () => {
  expect((await checkin(req(cases[0].body), params())).status).toBe(200);
  expect(m.stamp).toHaveBeenCalledWith(photo, expect.objectContaining({ transportCode: "TR-10",
    vehiclePlate: "B 1234 XY", vehicleDescription: "Box truck", driverName: "Assigned driver", label: "Check-in Depot" }));
});
it("keeps check-in geofence and assignment enforcement before stamping", async () => {
  expect((await checkin(req({ ...cases[0].body, latitude: 0 }), params())).status).toBe(422);
  m.auth.mockResolvedValue({ ...actor, employeeId: 999 });
  expect((await checkin(req(cases[0].body), params())).status).toBe(403);
  expect(m.stamp).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
});
it("keeps the pickup invoice and scan gates before mutation", async () => {
  m.pickup.mockResolvedValue({ id: 10, master, status: "ASSIGNED", pickupCode: "PU-10" });
  m.progress.mockResolvedValue({ allScanned: false, total: 1, scanned: 0 });
  expect((await pickup(req(cases[2].body), params())).status).toBe(422);
  m.progress.mockResolvedValue({ allScanned: true, total: 1, scanned: 1 });
  m.pickup.mockResolvedValue({ id: 10, master: { ...master, customer: { type: "b2b" } }, status: "ASSIGNED" });
  expect((await pickup(req(cases[2].body), params())).status).toBe(422);
  expect(m.metadata).not.toHaveBeenCalled(); expect(m.updatePickup).not.toHaveBeenCalled();
});
