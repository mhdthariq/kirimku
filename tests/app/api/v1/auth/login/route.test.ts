import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), roles: vi.fn(), verifyPassword: vi.fn(), createSession: vi.fn(),
  ensureRbac: vi.fn(), ensureSeed: vi.fn(), audit: vi.fn(),
  resolveTenantContext: vi.fn(), isDefaultTenant: vi.fn(), currentCompanyName: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { user: { findUnique: mocks.findUser }, userRole: { findMany: mocks.roles } } }));
vi.mock("@/infrastructure/auth/auth", () => ({ verifyPassword: mocks.verifyPassword, createSession: mocks.createSession, getAuthUser: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: mocks.ensureRbac }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: mocks.ensureSeed }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: mocks.audit }));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: mocks.resolveTenantContext,
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(),
  isDefaultTenant: mocks.isDefaultTenant, currentCompanyName: mocks.currentCompanyName,
}));
import { POST } from "../../../../../../src/app/api/v1/auth/login/route";

const user = { id: 7, username: "alice", name: "Alice", isOwner: false, isActive: true,
  passwordHash: "private-hash", employeeId: 9, employee: { warehouseId: 3, warehouse: { name: "Depot" } },
  partner: { id: 4, type: "MARKETING" } };
const request = (body: unknown) => new NextRequest("http://localhost/api/v1/auth/login", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTO_SEED_ON_BOOT", "false");
  mocks.isDefaultTenant.mockReturnValue(true);
  mocks.currentCompanyName.mockReturnValue("Tenant Company");
  mocks.findUser.mockResolvedValue(user);
  mocks.verifyPassword.mockReturnValue(true);
  mocks.createSession.mockResolvedValue({ token: "session-token", expiresAt: new Date("2026-10-09T00:00:00Z") });
  mocks.roles.mockResolvedValue([{ role: { id: 1, slug: "marketing", name: "Marketing", permissions: [
    { permission: { slug: "customer.view" } }, { permission: { slug: "customer.view" } },
    { permission: { slug: "customer.update" } },
  ] } }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/v1/auth/login", () => {
  it.each([{}, { username: "alice" }, { username: " ", password: "secret" }])("rejects missing credentials before lookup: %j", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: expect.any(Object) });
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("treats malformed JSON as missing credentials", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/auth/login", { method: "POST", body: "{" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ errors: { username: ["The username field is required."] } });
  });
  it.each(["missing", "inactive", "wrong password"])("returns the same non-disclosing error for %s accounts", async (scenario) => {
    if (scenario === "missing") mocks.findUser.mockResolvedValue(null);
    if (scenario === "inactive") mocks.findUser.mockResolvedValue({ ...user, isActive: false });
    if (scenario === "wrong password") mocks.verifyPassword.mockReturnValue(false);
    const response = await POST(request({ username: "alice", password: "secret" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Username atau password salah." });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    if (scenario !== "wrong password") expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });
  it("normalizes username and returns a sanitized session with deduplicated permissions", async () => {
    const response = await POST(request({ username: " Alice ", password: "secret" }));
    expect(response.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { username: "alice" } }));
    expect(mocks.verifyPassword).toHaveBeenCalledWith("secret", "private-hash");
    expect(mocks.createSession).toHaveBeenCalledWith(7);
    const body = await response.json();
    expect(body).toEqual({ data: { token: "session-token", expiresAt: "2026-10-09T00:00:00.000Z",
      user: { id: 7, username: "alice", name: "Alice", isOwner: false, isActive: true, employeeId: 9,
        warehouseId: 3, warehouseName: "Depot", partnerId: 4, partnerType: "MARKETING",
        roles: [{ id: 1, slug: "marketing", name: "Marketing" }], permissions: ["customer.view", "customer.update"] },
      company: { name: "Tenant Company" } } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "login", actor: body.data.user }));
    expect(mocks.ensureSeed).not.toHaveBeenCalled();
  });
  it("grants owners wildcard permissions and handles absent employee/partner relations", async () => {
    mocks.findUser.mockResolvedValue({ ...user, isOwner: true, employeeId: null, employee: null, partner: null });
    const response = await POST(request({ username: "alice", password: "secret" }));
    expect((await response.json()).data.user).toMatchObject({ permissions: ["*"], warehouseId: null, warehouseName: null, partnerId: null, partnerType: null });
  });
  it.each([true, false])("auto-seeds only an opted-in default tenant (default=%s)", async (defaultTenant) => {
    vi.stubEnv("AUTO_SEED_ON_BOOT", "true");
    mocks.isDefaultTenant.mockReturnValue(defaultTenant);
    await POST(request({ username: "alice", password: "secret" }));
    expect(mocks.ensureSeed).toHaveBeenCalledTimes(defaultTenant ? 1 : 0);
  });
  it("does not expose database errors or issue a session after lookup failure", async () => {
    mocks.findUser.mockRejectedValue(new Error("database credentials leaked here"));
    const response = await POST(request({ username: "alice", password: "secret" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Internal server error." });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("does not access the database when tenant resolution fails", async () => {
    mocks.resolveTenantContext.mockRejectedValue(new Error("license service unavailable"));
    expect((await POST(request({ username: "alice", password: "secret" }))).status).toBe(500);
    expect(mocks.ensureRbac).not.toHaveBeenCalled();
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
});
