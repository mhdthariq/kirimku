import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), hasPermission: vi.fn(), find: vi.fn(), employee: vi.fn(), transport: vi.fn(),
  transaction: vi.fn(), updateDelivery: vi.fn(), updateShipment: vi.fn(), tracking: vi.fn(),
  scope: vi.fn(), assignment: vi.fn(), progress: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { delivery: { findUnique: mocks.find }, employee: { findUnique: mocks.employee },
  transport: { findFirst: mocks.transport }, $transaction: mocks.transaction,
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: mocks.getAuthUser, hasPermission: mocks.hasPermission }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: mocks.audit }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: mocks.scope }));
vi.mock("@/infrastructure/services/scan-flow", () => ({ assertKurirAssignment: mocks.assignment, scanProgress: mocks.progress }));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { HttpError } from "@/shared/http-error";
import { POST } from "../../../../../../../src/app/api/v1/deliveries/[id]/complete/route";

const actor = { id: 7, name: "Courier", permissions: ["delivery.confirm"], isOwner: false };
const delivery = { id: 12, deliveryCode: "DLV-12", masterId: 20, kurirId: 9, status: "IN_PROGRESS", notes: "Existing note",
  master: { id: 20, status: "IN_TRANSIT", fulfillmentMode: "STANDARD", customer: { name: "Customer" }, details: [{ detailCode: "PKG-1" }] } };
const photo = "data:image/jpeg;base64,YQ==";
const validBody = { proofOfDelivery: " Receiver ", photoUrl: photo };
const params = () => ({ params: Promise.resolve({ id: "12" }) });
const request = (body: unknown = validBody) => new NextRequest("http://localhost/api/v1/deliveries/12/complete", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthUser.mockResolvedValue(actor);
  mocks.hasPermission.mockReturnValue(true);
  mocks.find.mockResolvedValue(delivery);
  mocks.progress.mockResolvedValue({ allScanned: true, scanned: 1, total: 1, details: [{ detailCode: "PKG-1", scanned: true }] });
  mocks.employee.mockResolvedValue({ name: "Assigned Courier" });
  mocks.updateDelivery.mockResolvedValue({ id: 12, status: "COMPLETED", proofOfDelivery: "Receiver", photoUrl: photo });
  mocks.transaction.mockImplementation(async (fn) => fn({ delivery: { update: mocks.updateDelivery },
    masterShipment: { update: mocks.updateShipment }, trackingEvent: { create: mocks.tracking } }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/v1/deliveries/[id]/complete", () => {
  it.each([401, 403])("rejects auth failures (%s) before reading delivery data", async (status) => {
    if (status === 401) mocks.getAuthUser.mockResolvedValue(null);
    else mocks.hasPermission.mockReturnValue(false);
    const response = await POST(request(), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: status === 401 ? "Unauthenticated." : "Missing permission: delivery.confirm" });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing delivery", async () => {
    mocks.find.mockResolvedValue(null);
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Delivery tidak ditemukan." });
    expect(mocks.scope).not.toHaveBeenCalled();
  });
  it("enforces shipment scope before scanning or mutation", async () => {
    mocks.scope.mockRejectedValue(new HttpError(403, "Outside warehouse scope"));
    const response = await POST(request(), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Outside warehouse scope" });
    expect(mocks.scope).toHaveBeenCalledWith(actor, delivery.master);
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["COMPLETED", "FAILED"])("rejects terminal delivery status %s", async (status) => {
    mocks.find.mockResolvedValue({ ...delivery, status });
    const response = await POST(request(), params());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: status === "COMPLETED" ? "Delivery sudah selesai." : "Delivery ditandai gagal - buat task baru bila perlu." });
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects a courier assignment denial without scanning or writing", async () => {
    mocks.assignment.mockReturnValue("Assigned to another courier");
    const response = await POST(request(), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Assigned to another courier" });
    expect(mocks.assignment).toHaveBeenCalledWith(delivery, actor, "delivery.assign_kurir", "DLV-12");
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects a shipment with no packages even when scan progress says complete", async () => {
    mocks.find.mockResolvedValue({ ...delivery, master: { ...delivery.master, details: [] } });
    const response = await POST(request(), params());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "Shipment belum punya detail barang." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("reports only unscanned package codes and prevents premature completion", async () => {
    mocks.progress.mockResolvedValue({ allScanned: false, scanned: 1, total: 2,
      details: [{ detailCode: "PKG-1", scanned: true }, { detailCode: "PKG-2", scanned: false }] });
    const response = await POST(request(), params());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "Belum semua paket discan (1/2). Sisa: PKG-2" });
    expect(mocks.progress).toHaveBeenCalledWith({ deliveryId: 12 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([
    [{ photoUrl: photo }, "The proofOfDelivery field is required."],
    [{ proofOfDelivery: "Receiver" }, "Foto bukti serah terima wajib disertakan sebelum konfirmasi."],
    [{ proofOfDelivery: "Receiver", photoUrl: "https://example.com/photo.jpg" }, "Format foto tidak didukung - gunakan JPEG atau PNG."],
    [{ proofOfDelivery: "Receiver", photoUrl: "data:image/gif;base64,YQ==" }, "Format foto tidak didukung - gunakan JPEG atau PNG."],
    [{ proofOfDelivery: "Receiver", photoUrl: "data:image/png;base64," + "a".repeat(2_500_000) }, "Foto terlalu besar (maks ±2.5 MB setelah kompresi)."],
  ])("rejects invalid proof/photo without mutations (case %#)", async (body, message) => {
    const response = await POST(request(body), params());
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe(message);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("atomically completes delivery, updates shipment, records tracking, and audits proof", async () => {
    const response = await POST(request(), params());
    const tracking = "Delivered to Customer by Assigned Courier - received by: Receiver";
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 12, status: "COMPLETED", proofOfDelivery: "Receiver", photoUrl: photo, tracking } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateDelivery).toHaveBeenCalledWith({ where: { id: 12 }, data: {
      status: "COMPLETED", completedAt: expect.any(Date), proofOfDelivery: "Receiver", notes: "Existing note", photoUrl: photo,
    } });
    expect(mocks.updateShipment).toHaveBeenCalledWith({ where: { id: 20 }, data: { status: "DELIVERED" } });
    expect(mocks.tracking).toHaveBeenCalledWith({ data: { masterId: 20, event: "DELIVERED", description: tracking, actorId: 7 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change", entityId: 12, actor,
      after: { packagesScanned: "1/1", proof: "Receiver", kurir: "Assigned Courier", hasPhoto: true } }));
    expect(mocks.transport).not.toHaveBeenCalled();
  });
  it("does not rewrite an already-delivered shipment and falls back to the actor name", async () => {
    mocks.find.mockResolvedValue({ ...delivery, kurirId: null, master: { ...delivery.master, status: "DELIVERED" } });
    const response = await POST(request({ ...validBody, notes: " New note ", photoUrl: "data:image/png;base64,YQ==" }), params());
    expect(response.status).toBe(200);
    expect((await response.json()).data.tracking).toBe("Delivered to Customer by Courier - received by: Receiver");
    expect(mocks.updateShipment).not.toHaveBeenCalled();
    expect(mocks.employee).not.toHaveBeenCalled();
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: "New note", photoUrl: "data:image/png;base64,YQ==" }) }));
  });
  it.each([true, false])("uses the latest DIRECT checkpoint when available (%s), otherwise standard tracking", async (hasCheckpoint) => {
    mocks.find.mockResolvedValue({ ...delivery, master: { ...delivery.master, fulfillmentMode: "DIRECT" } });
    mocks.transport.mockResolvedValue(hasCheckpoint ? { checkpointRecords: [{ checkpoint: { name: "Final Depot" } }] } : null);
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect((await response.json()).data.tracking).toBe(hasCheckpoint ? "Delivery Success on 'Final Depot'" : "Delivered to Customer by Assigned Courier - received by: Receiver");
    expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ where: { shipments: { some: { shipmentId: 20 } } },
      include: expect.objectContaining({ checkpointRecords: { orderBy: { recordedAt: "desc" }, take: 1, include: { checkpoint: true } } }) }));
  });
  it("returns a sanitized error when the transaction fails and does not audit completion", async () => {
    mocks.tracking.mockRejectedValue(new Error("database write failed"));
    const response = await POST(request(), params());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Internal server error." });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
