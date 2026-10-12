import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), scope: vi.fn(), transport: vi.fn(),
  find: vi.fn(), findUnique: vi.fn(), list: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  transport: { findUnique: m.transport }, transportExpense: { findFirst: m.find, findUnique: m.findUnique,
    findMany: m.list, create: m.create, updateMany: m.updateMany, deleteMany: m.deleteMany },
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: m.permission }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: vi.fn().mockResolvedValue("EXP-1") }));
vi.mock("@/infrastructure/services/transport-ops-server", async (original) => ({
  ...await original<typeof import("@/infrastructure/services/transport-ops-server")>(), assertTransportAccess: m.scope,
}));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
import { HttpError } from "@/shared/http-error";
import { GET as list, POST as create } from "@/app/api/v1/transports/[id]/expenses/route";
import { PUT as update, DELETE as remove } from "@/app/api/v1/transports/[id]/expenses/[expenseId]/route";
import { POST as approve } from "@/app/api/v1/transports/[id]/expenses/[expenseId]/approve/route";

const actor = { id: 7, username: "finance.andi", isOwner: false, roles: [{ id: 2, slug: "admin-finance", name: "Admin Finance" }], permissions: [] };
const transport = { id: 10, transportCode: "TR-10", route: null, shipments: [] };
const gps = { latitude: -6.2, longitude: 106.8, locationAccuracy: 5 };
const expense = { id: 12, expenseCode: "EXP-12", transportId: 10, type: "BBM", amount: 100, status: "PENDING", photoUrl: null, ...gps, transport };
const body = { type: "BBM", amount: 100, ...gps };
const params = () => ({ params: Promise.resolve({ id: "10", expenseId: "12" }) });
const req = (data: unknown = body) => new NextRequest("http://localhost/api/v1/transports/10/expenses/12", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(actor); m.permission.mockReturnValue(true); m.transport.mockResolvedValue(transport);
  m.find.mockResolvedValue(expense); m.findUnique.mockResolvedValue(expense); m.create.mockResolvedValue(expense);
  m.updateMany.mockResolvedValue({ count: 1 }); m.deleteMany.mockResolvedValue({ count: 1 });
});

describe("expense API approval and GPS", () => {
  it.each([create, update])("requires fresh GPS for writes %#", async (route) => {
    for (const payload of [{ type: "BBM", amount: 100 }, { ...body, latitude: null }, { ...body, locationAccuracy: -1 }, null]) {
      expect((await route(req(payload), params())).status).toBe(422);
    }
    expect(m.create).not.toHaveBeenCalled(); expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("creates PENDING expenses with GPS and optional receipt", async () => {
    const response = await create(req({ ...body, status: "APPROVED", approvedById: 999 }), params());
    expect(response.status).toBe(200);
    expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ...gps, status: "PENDING", createdById: actor.id, photoUrl: null }) });
    expect(m.create.mock.calls[0][0].data.approvedById).toBeUndefined();
    expect((await response.json()).data.hasPhoto).toBe(false);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "create", after: expect.objectContaining(gps) }));
  });
  it("updates only pending rows with GPS, ignoring client approval metadata", async () => {
    expect((await update(req({ ...body, amount: 200, status: "APPROVED", approvedByUsername: "forged" }), params())).status).toBe(200);
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 12, transportId: 10, status: "PENDING" }, data: { ...gps, type: "BBM", amount: 200 } });
  });
  it.each([update, remove, approve])("rejects already approved entries %#", async (route) => {
    m.find.mockResolvedValue({ ...expense, status: "APPROVED" });
    expect((await route(req(), params())).status).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled(); expect(m.deleteMany).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([update, remove, approve])("rejects a concurrent approval/delete with no audit %#", async (route) => {
    m.updateMany.mockResolvedValue({ count: 0 }); m.deleteMany.mockResolvedValue({ count: 0 });
    expect((await route(req(), params())).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([create, update, remove, approve])("enforces transport scope before writing %#", async (route) => {
    m.scope.mockRejectedValue(new HttpError(403, "Outside scope"));
    expect((await route(req(), params())).status).toBe(403);
    expect(m.updateMany).not.toHaveBeenCalled(); expect(m.deleteMany).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it.each([401, 403])("enforces approval authentication/permission (%s)", async (status) => {
    if (status === 401) m.auth.mockResolvedValue(null); else m.permission.mockReturnValue(false);
    const response = await approve(req(), params());
    expect(response.status).toBe(status);
    expect(m.find).not.toHaveBeenCalled();
    if (status === 403) expect(m.permission).toHaveBeenCalledWith(actor, "transport.expense.approve");
  });
  it("looks up expense within its transport and returns 404 for missing/mismatched ids", async () => {
    m.find.mockResolvedValue(null);
    expect((await approve(req(), params())).status).toBe(404);
    expect(m.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12, transportId: 10 } }));
    expect(m.updateMany).not.toHaveBeenCalled();
  });
  it("atomically approves with trusted username/role snapshot and audits", async () => {
    m.findUnique.mockResolvedValue({ ...expense, status: "APPROVED", approvedByUsername: actor.username, approvedByRole: "Admin Finance" });
    const response = await approve(req({ approvedByUsername: "forged" }), params());
    expect(response.status).toBe(200);
    const approval = { status: "APPROVED", approvedAt: expect.any(Date), approvedById: 7, approvedByUsername: actor.username, approvedByRole: "Admin Finance" };
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 12, transportId: 10, status: "PENDING" }, data: approval });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", actor, before: { status: "PENDING" }, after: approval }));
    expect((await response.json()).data.photoUrl).toBeUndefined();
  });
  it("snapshots all role names deterministically and Owner explicitly", async () => {
    m.auth.mockResolvedValue({ ...actor, roles: [{ name: "Admin Finance" }, { name: "Admin Kantor" }] });
    await approve(req(), params());
    expect(m.updateMany.mock.calls[0][0].data.approvedByRole).toBe("Admin Finance, Admin Kantor");
    m.auth.mockResolvedValue({ ...actor, isOwner: true });
    await approve(req(), params());
    expect(m.updateMany.mock.calls[1][0].data.approvedByRole).toBe("Owner");
  });
  it("deletes only pending expenses", async () => {
    expect((await remove(req(), params())).status).toBe(200);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: 12, transportId: 10, status: "PENDING" } });
  });
  it("lists pending expenses but excludes them from totals and strips receipt data", async () => {
    m.list.mockResolvedValue([{ ...expense, transport: undefined }, { ...expense, id: 13, status: "APPROVED", amount: 200, photoUrl: "data:image/jpeg;base64,YQ==" }]);
    const response = await list(req(), params());
    const result = await response.json();
    expect(result.meta.summary.total).toBe(200);
    expect(result.meta.summary.count).toBe(1);
    expect(result.data[1].hasPhoto).toBe(true);
    expect(result.data[1].photoUrl).toBeUndefined();
  });
});
