import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), expire: vi.fn(), list: vi.fn(), find: vi.fn(), duplicate: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  tariff: { updateMany: m.expire, findMany: m.list, findUnique: m.find, findFirst: m.duplicate, create: m.create, update: m.update, delete: m.remove },
  customer: { findUnique: async () => ({ id: 8, type: "b2b" }) },
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission) }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit, diffFields: vi.fn() }));
import { GET, POST } from "@/app/api/v1/tariffs/route";
import { PUT, DELETE } from "@/app/api/v1/tariffs/[id]/route";
import { tariffEndDate } from "@/infrastructure/services/tariff-lifecycle";

const payload = { name: "UD Sumatra Jaya Banda Aceh", origin: "Medan", destination: "Banda Aceh", customerType: "b2b", customerId: 8, pricingMethod: "PER_CUBIC", ratePerCubic: 185000, effectiveFrom: "2026-10-17" };
const old = { ...payload, id: 1, ratePerCubic: 135000, isActive: false, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-10-16T23:59:59.999Z") };
const req = (method: string, body?: unknown) => new NextRequest("http://localhost/api/v1/tariffs", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const params = { params: Promise.resolve({ id: "1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  m.auth.mockResolvedValue({ id: 1, permissions: ["tariff.view", "tariff.create", "tariff.update"] });
  m.expire.mockResolvedValue({ count: 1 });
  m.list.mockResolvedValue([old]);
  m.find.mockResolvedValue(old);
  m.duplicate.mockResolvedValue(null);
  m.create.mockImplementation(async ({ data }) => ({ id: 2, ...data }));
  m.update.mockImplementation(async ({ data }) => ({ ...old, ...data }));
  m.remove.mockResolvedValue(old);
});
afterEach(() => vi.useRealTimers());

describe("tariff lifecycle", () => {
  it("expires stored flags before listing tariffs", async () => {
    expect((await GET(req("GET"))).status).toBe(200);
    expect(m.expire).toHaveBeenCalledWith({ where: { isActive: true, effectiveTo: { lt: new Date() } }, data: { isActive: false } });
    expect(m.expire.mock.invocationCallOrder[0]).toBeLessThan(m.list.mock.invocationCallOrder[0]);
    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ _count: { select: { shipments: true } } }) }));
  });
  it("creates the replacement with a distinct primary ID after expiring the old rate", async () => {
    const response = await POST(req("POST", payload));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: 2, name: payload.name, ratePerCubic: 185000, isActive: true });
    expect(m.expire.mock.invocationCallOrder[0]).toBeLessThan(m.duplicate.mock.invocationCallOrder[0]);
    expect(m.duplicate).toHaveBeenCalledWith({ where: { origin: "Medan", destination: "Banda Aceh", name: payload.name, customerType: "b2b", customerId: 8, isActive: true } });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a second active version", async () => {
    m.duplicate.mockResolvedValue({ id: 3 });
    expect((await POST(req("POST", payload))).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("allows repeated historical inactive versions", async () => {
    m.duplicate.mockResolvedValue({ id: 3 });
    expect((await POST(req("POST", { ...payload, effectiveFrom: "2026-01-01", effectiveTo: "2026-10-16" }))).status).toBe(200);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });
  it("blocks reactivating an old ID over an active replacement", async () => {
    m.duplicate.mockResolvedValue({ id: 2 });
    expect((await PUT(req("PUT", { effectiveTo: null, isActive: true }), params)).status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("explains why an expired tariff cannot be reactivated", async () => {
    expect((await PUT(req("PUT", { isActive: true }), params)).status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("reactivates an inactive tariff with valid dates using its original ID", async () => {
    const response = await PUT(req("PUT", { isActive: true, effectiveTo: null }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: 1, isActive: true, effectiveTo: null });
    expect(m.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ isActive: true }) });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("deactivates a tariff without deleting it", async () => {
    m.find.mockResolvedValue({ ...old, isActive: true, effectiveTo: null });
    expect((await PUT(req("PUT", { isActive: false }), params)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
    expect(m.remove).not.toHaveBeenCalled();
  });
  it.each([true, false])("permanently deletes a tariff with active status %s", async (isActive) => {
    m.find.mockResolvedValue({ ...old, isActive });
    const response = await DELETE(req("DELETE"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ deleted: true });
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 1, shipments: { none: {} } } });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", entityId: 1 }));
  });
  it.each([true, false])("blocks deletion of a linked tariff with active status %s", async (isActive) => {
    m.find.mockResolvedValue({ ...old, isActive });
    m.remove.mockRejectedValue({ code: "P2025" });
    const response = await DELETE(req("DELETE"), params);
    expect(response.status).toBe(409);
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 1, shipments: { none: {} } } });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("requires update permission for permanent deletion", async () => {
    m.auth.mockResolvedValue({ id: 1, permissions: ["tariff.view"] });
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("returns not found when deleting a missing tariff", async () => {
    m.find.mockResolvedValue(null);
    expect((await DELETE(req("DELETE"), params)).status).toBe(404);
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("rejects non-boolean status values", async () => {
    expect((await PUT(req("PUT", { isActive: "false" }), params)).status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("handles concurrent database uniqueness conflicts", async () => {
    m.create.mockRejectedValue({ code: "P2002" });
    expect((await POST(req("POST", payload))).status).toBe(422);
  });
  it("includes the final validity day and rejects reversed ranges", async () => {
    expect(tariffEndDate("2026-10-17")?.toISOString()).toBe("2026-10-17T23:59:59.999Z");
    expect((await POST(req("POST", { ...payload, effectiveTo: "2026-10-17" }))).status).toBe(200);
    expect((await POST(req("POST", { ...payload, effectiveTo: "2026-10-16" }))).status).toBe(422);
  });
  it("checks permission before changing expired flags", async () => {
    m.auth.mockResolvedValue({ id: 1, permissions: [] });
    expect((await GET(req("GET"))).status).toBe(403);
    expect(m.expire).not.toHaveBeenCalled();
  });
});
