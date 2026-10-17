import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), expire: vi.fn(), list: vi.fn(), find: vi.fn(), duplicate: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  tariff: { updateMany: m.expire, findMany: m.list, findUnique: m.find, findFirst: m.duplicate, create: m.create, update: m.update },
  customer: { findUnique: async () => ({ id: 8, type: "b2b" }) },
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission) }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit, diffFields: vi.fn() }));
import { GET, POST } from "@/app/api/v1/tariffs/route";
import { PUT } from "@/app/api/v1/tariffs/[id]/route";
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
});
afterEach(() => vi.useRealTimers());

describe("tariff lifecycle", () => {
  it("expires stored flags before listing tariffs", async () => {
    expect((await GET(req("GET"))).status).toBe(200);
    expect(m.expire).toHaveBeenCalledWith({ where: { isActive: true, effectiveTo: { lt: new Date() } }, data: { isActive: false } });
    expect(m.expire.mock.invocationCallOrder[0]).toBeLessThan(m.list.mock.invocationCallOrder[0]);
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
  it("keeps expired tariffs inactive even when activation is requested", async () => {
    expect((await PUT(req("PUT", { isActive: true }), params)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
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
