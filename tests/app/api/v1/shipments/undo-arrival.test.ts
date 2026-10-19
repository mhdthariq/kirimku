import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), scope: vi.fn(), find: vi.fn(), update: vi.fn(), scans: vi.fn(), pickup: vi.fn(), tracking: vi.fn(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("@/composition/api-helpers", () => ({ guard: m.guard, ok: (data: unknown) => Response.json({ data }), fail: (status: number, message: string) => Response.json({ message }, { status }), handle: async (_req: unknown, fn: () => Promise<Response>) => { try { return await fn(); } catch (error) { const e = error as { status?: number; message: string }; return Response.json({ message: e.message }, { status: e.status ?? 500 }); } } }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: m.scope }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, masterShipment: { findUnique: m.find, updateMany: m.update }, handoverScan: { deleteMany: m.scans }, pickup: { updateMany: m.pickup }, trackingEvent: { create: m.tracking }, auditLog: { create: m.audit } }) } }));
import { POST } from "@/app/api/v1/shipments/[id]/undo-arrival/route";
import { HttpError } from "@/shared/http-error";
const shipment = { id: 12, masterCode: "MS-12", status: "ARRIVED_AT_GUDANG", destReceivedAt: new Date(), arrivalPreviousStatus: "AT_DEST_GUDANG", deliveries: [], transportItems: [], expenses: [] };
const req = (reason: unknown = "wrong receipt") => new NextRequest("http://localhost/api/v1/shipments/12/undo-arrival", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
const params = () => ({ params: Promise.resolve({ id: "12" }) });
beforeEach(() => { vi.resetAllMocks(); m.guard.mockResolvedValue({ id: 7 }); m.find.mockResolvedValue(shipment); m.update.mockResolvedValue({ count: 1 }); });
describe("undo warehouse arrival", () => {
  it("restores a legacy warehouse receipt from its tracking history without cancelling the shipment", async () => {
    m.find.mockResolvedValue({ ...shipment, status: "RECEIVED_AT_GUDANG", destReceivedAt: null, arrivalPreviousStatus: null, trackingEvents: [{ event: "RECEIVED_AT_GUDANG" }, { event: "READY_FOR_PICKUP" }, { event: "CREATED" }], pickups: [] });
    const response = await POST(req(), params());
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("READY_FOR_PICKUP");
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "READY_FOR_PICKUP" }) }));
  });
  it("requires the dedicated permission and applies shipment scope", async () => {
    m.guard.mockRejectedValue(new HttpError(403, "Missing permission"));
    expect((await POST(req(), params())).status).toBe(403);
    expect(m.guard).toHaveBeenCalledWith(expect.anything(), "shipment.undo_arrival");
    expect(m.find).not.toHaveBeenCalled();
    m.guard.mockResolvedValue({ id: 7 }); m.scope.mockRejectedValue(new HttpError(403, "Outside warehouse"));
    expect((await POST(req(), params())).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([null, "", " ", "x".repeat(1001)])("requires a reason %#", async reason => {
    expect((await POST(req(reason), params())).status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("undoes destination receipt, clears scans and audits the reason", async () => {
    expect((await POST(req(), params())).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ where: { id: 12, status: "ARRIVED_AT_GUDANG", destReceivedAt: shipment.destReceivedAt }, data: { status: "AT_DEST_GUDANG", destReceivedAt: null, arrivalPreviousStatus: null } });
    expect(m.scans).toHaveBeenCalledWith({ where: { masterId: 12, context: "transport_arrival" } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "undo_arrival", actorId: 7, afterData: JSON.stringify({ status: "AT_DEST_GUDANG", reason: "wrong receipt" }) }) });
  });
  it("restores a pickup when origin receipt is undone", async () => {
    m.find.mockResolvedValue({ ...shipment, status: "RECEIVED_AT_GUDANG", destReceivedAt: null, arrivalPreviousStatus: "PICKED_UP" });
    expect((await POST(req(), params())).status).toBe(200);
    expect(m.pickup).toHaveBeenCalledWith({ where: { masterId: 12, status: "COMPLETED" }, data: { status: "PICKED_UP", completedAt: null } });
    expect(m.scans).toHaveBeenCalledWith({ where: { masterId: 12, context: "gudang_arrival" } });
  });
  it.each([
    { deliveries: [{ status: "ASSIGNED" }] },
    { expenses: [{ status: "APPROVED" }] },
    { expenses: [{ status: "PENDING" }] },
    { status: "DELIVERED" },
    { status: "ARRIVED_AT_GUDANG", destReceivedAt: null },
    { status: "RECEIVED_AT_GUDANG", arrivalPreviousStatus: "CREATED", transportItems: [{ transportId: 3 }] },
  ])("rejects downstream work and unconfirmed receipt %#", async changes => {
    m.find.mockResolvedValue({ ...shipment, ...changes });
    expect((await POST(req(), params())).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects concurrent changes before clearing scans", async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect((await POST(req(), params())).status).toBe(409);
    expect(m.scans).not.toHaveBeenCalled();
  });
});
