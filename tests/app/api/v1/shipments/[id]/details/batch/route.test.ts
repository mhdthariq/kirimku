import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/shared/http-error";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), hasPermission: vi.fn(), transaction: vi.fn(), master: vi.fn(),
  find: vi.fn(), update: vi.fn(), delete: vi.fn(), scope: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: mocks.getAuthUser, hasPermission: mocks.hasPermission }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: mocks.audit }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: mocks.scope }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: vi.fn(), runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { PUT, DELETE } from "@/app/api/v1/shipments/[id]/details/batch/route";

const actor = { id: 7, permissions: ["shipment_detail.update", "shipment_detail.delete"] };
const master = { id: 12, status: "CREATED" };
const originals = [1, 2, 3].map((id) => ({ id, masterId: 12, detailCode: `D-${id}`, description: "Old", actualWeightKg: 1 }));
let rows: typeof originals;
let committed: boolean;
const payload = { detailIds: [1, 2], description: " Updated ", lengthCm: 0, widthCm: 2, heightCm: null, volumeM3: null, actualWeightKg: 0 };
const params = (id = "12") => ({ params: Promise.resolve({ id }) });
const request = (method: string, body: unknown = payload) => new NextRequest("http://localhost/api/v1/shipments/12/details/batch", {
  method, body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const routes = [["PUT", PUT, "shipment_detail.update"], ["DELETE", DELETE, "shipment_detail.delete"]] as const;

beforeEach(() => {
  vi.resetAllMocks();
  rows = originals.map((row) => ({ ...row }));
  committed = false;
  mocks.getAuthUser.mockResolvedValue(actor);
  mocks.hasPermission.mockImplementation((user, permission) => user.permissions.includes(permission));
  mocks.master.mockResolvedValue(master);
  mocks.find.mockImplementation(async ({ where }) => rows.filter((row) => row.masterId === where.masterId && where.id.in.includes(row.id)).map((row) => ({ ...row })));
  mocks.update.mockImplementation(async ({ where, data }) => {
    const selected = rows.filter((row) => row.masterId === where.masterId && where.id.in.includes(row.id));
    for (const row of selected) Object.assign(row, data);
    return { count: selected.length };
  });
  mocks.delete.mockImplementation(async ({ where }) => {
    const selected = rows.filter((row) => row.masterId === where.masterId && where.id.in.includes(row.id));
    rows = rows.filter((row) => !selected.includes(row));
    return { count: selected.length };
  });
  mocks.transaction.mockImplementation(async (fn) => {
    const snapshot = rows.map((row) => ({ ...row }));
    try {
      const result = await fn({ masterShipment: { findUnique: mocks.master }, detailShipment: { findMany: mocks.find, updateMany: mocks.update, deleteMany: mocks.delete } });
      committed = true;
      return result;
    } catch (error) {
      rows = snapshot;
      throw error;
    }
  });
  mocks.audit.mockImplementation(async () => { expect(committed).toBe(true); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function expectUnchanged() {
  expect(rows).toEqual(originals);
  expect(mocks.audit).not.toHaveBeenCalled();
}

describe("/shipments/[id]/details/batch", () => {
  for (const [method, route, permission] of routes) {
    describe(method, () => {
      it("requires authentication", async () => {
        mocks.getAuthUser.mockResolvedValue(null);
        expect((await route(request(method), params())).status).toBe(401);
        expect(mocks.transaction).not.toHaveBeenCalled();
      });
      it(`requires ${permission}`, async () => {
        mocks.getAuthUser.mockResolvedValue({ ...actor, permissions: [] });
        const response = await route(request(method), params());
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ message: `Missing permission: ${permission}` });
        expect(mocks.transaction).not.toHaveBeenCalled();
      });
      it("enforces scope inside the transaction", async () => {
        mocks.scope.mockRejectedValue(new HttpError(403, "Wrong warehouse"));
        expect((await route(request(method), params())).status).toBe(403);
        expect(mocks.scope).toHaveBeenCalledWith(actor, master);
        expect(mocks.find).not.toHaveBeenCalled();
        expectUnchanged();
      });
      it("returns 404 for a missing master", async () => {
        mocks.master.mockResolvedValue(null);
        expect((await route(request(method), params())).status).toBe(404);
        expectUnchanged();
      });
      it.each(["PICKED_UP", "IN_TRANSPORT", "DELIVERED", "CANCELLED"])("rejects transaction-time status %s", async (status) => {
        mocks.master.mockResolvedValue({ ...master, status });
        expect((await route(request(method), params())).status).toBe(422);
        expect(mocks.find).not.toHaveBeenCalled();
        expectUnchanged();
      });
      it.each([undefined, null, [], [1, 1], [0], [-1], [1.5], ["1"], [true], [Number.MAX_SAFE_INTEGER + 1]])("rejects invalid detailIds %j", async (detailIds) => {
        expect((await route(request(method, { ...payload, detailIds }), params())).status).toBe(422);
        expect(mocks.transaction).not.toHaveBeenCalled();
        expectUnchanged();
      });
      it.each([null, [], "invalid"])("rejects invalid body %j", async (body) => {
        expect((await route(request(method, body), params())).status).toBe(422);
        expectUnchanged();
      });
      it("rejects malformed JSON", async () => {
        const req = new NextRequest("http://localhost/api", { method, body: "{" });
        expect((await route(req, params())).status).toBe(422);
        expectUnchanged();
      });
      it.each(["bad", "0", "-1", "1.5"])("rejects invalid master ID %s", async (id) => {
        expect((await route(request(method), params(id))).status).toBe(422);
        expectUnchanged();
      });
      it.each(["missing", "foreign"])("rejects a mixed batch with a %s ID before writing", async (kind) => {
        if (kind === "foreign") rows[1].masterId = 99;
        const snapshot = rows.map((row) => ({ ...row }));
        const body = { ...payload, detailIds: [1, kind === "missing" ? 999 : 2] };
        const response = await route(request(method, body), params());
        expect(response.status).toBe(422);
        expect((await response.json()).errors).toHaveProperty("detailIds");
        expect(rows).toEqual(snapshot);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.delete).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
      });
      it("rolls back a short write and does not audit", async () => {
        const mutation = method === "PUT" ? mocks.update : mocks.delete;
        mutation.mockImplementationOnce(async () => { rows.splice(0, 1); return { count: 1 }; });
        expect((await route(request(method), params())).status).toBe(409);
        expectUnchanged();
      });
      it("rolls back a database failure and returns a sanitized error", async () => {
        const mutation = method === "PUT" ? mocks.update : mocks.delete;
        mutation.mockImplementationOnce(async () => { rows.splice(0, 1); throw new Error("private database failure"); });
        const response = await route(request(method), params());
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ message: "Internal server error." });
        expectUnchanged();
      });
      it("returns a retryable conflict for a serialization failure without auditing", async () => {
        mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "6.11.1" }));
        expect((await route(request(method), params())).status).toBe(409);
        expectUnchanged();
      });
      it.each(["CREATED", "READY_FOR_PICKUP"])("mutates only selected rows in %s and audits after commit", async (status) => {
        mocks.master.mockResolvedValue({ ...master, status });
        const response = await route(request(method), params());
        expect(response.status).toBe(200);
        expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
        expect(rows.find((row) => row.id === 3)).toEqual(originals[2]);
        if (method === "PUT") {
          expect(await response.json()).toEqual({ data: { updated: 2, details: rows.slice(0, 2) } });
          expect(rows[0]).toMatchObject({ description: "Updated", lengthCm: 0, widthCm: 2, heightCm: null, volumeM3: null, actualWeightKg: 0 });
        } else {
          expect(await response.json()).toEqual({ data: { deleted: 2 } });
          expect(rows).toEqual([originals[2]]);
        }
        expect(mocks.audit).toHaveBeenCalledTimes(2);
        for (const before of originals.slice(0, 2)) {
          expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: method === "PUT" ? "updated" : "deleted", entityType: "shipment_detail",
            entityId: before.id, entityLabel: before.detailCode, actor, before,
            ...(method === "PUT" ? { after: rows.find((row) => row.id === before.id) } : {}),
          }));
        }
      });
    });
  }
  for (const field of ["lengthCm", "widthCm", "heightCm", "volumeM3", "actualWeightKg"]) {
    it.each([-1, "2", "NaN", true, {}, []])(`rejects invalid ${field}: %j`, async (value) => {
      const response = await PUT(request("PUT", { ...payload, [field]: value }), params());
      expect(response.status).toBe(422);
      expect((await response.json()).errors).toHaveProperty(field);
      expectUnchanged();
    });
    it(`rejects nonfinite ${field} before mutation`, async () => {
      const req = request("PUT");
      vi.spyOn(req, "json").mockResolvedValue({ ...payload, [field]: Infinity });
      expect((await PUT(req, params())).status).toBe(422);
      expectUnchanged();
    });
  }
  it.each(["", "   ", null, 123])("rejects invalid description %j", async (description) => {
    expect((await PUT(request("PUT", { ...payload, description }), params())).status).toBe(422);
    expectUnchanged();
  });
  it("rejects null weight", async () => {
    expect((await PUT(request("PUT", { ...payload, actualWeightKg: null }), params())).status).toBe(422);
    expectUnchanged();
  });
  it("rejects an empty update", async () => {
    expect((await PUT(request("PUT", { detailIds: [1, 2] }), params())).status).toBe(422);
    expectUnchanged();
  });
  it("supports partial updates and ignores reassignment fields", async () => {
    expect((await PUT(request("PUT", { detailIds: [1], volumeM3: 0.5, masterId: 99, detailCode: "changed" }), params())).status).toBe(200);
    expect(rows[0]).toEqual({ ...originals[0], volumeM3: 0.5 });
    expect(rows.slice(1)).toEqual(originals.slice(1));
  });
  it("rolls back if reading updated results fails", async () => {
    mocks.find.mockResolvedValueOnce(originals.slice(0, 2)).mockRejectedValueOnce(new Error("read failed"));
    expect((await PUT(request("PUT"), params())).status).toBe(500);
    expectUnchanged();
  });
});
