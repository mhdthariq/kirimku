import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn() }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: m.tenant, runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { GET } from "@/app/api/v1/mobile/config/route";

const request = () => new NextRequest("https://example.test/api/v1/mobile/config", { headers: { "x-corp-id": "fleet" } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MOBILE_ANDROID_MIN_VERSION_CODE", "");
  vi.stubEnv("MOBILE_ANDROID_LATEST_VERSION_CODE", "");
  vi.stubEnv("MOBILE_DISTRIBUTION", "");
  m.auth.mockResolvedValue({ id: 7 });
});
afterEach(() => vi.unstubAllEnvs());
describe("mobile capabilities", () => {
  it("requires authentication after tenant resolution", async () => {
    m.auth.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(m.tenant).toHaveBeenCalledWith(expect.any(Headers));
  });
  it("defaults to private Android distribution and reports truthful capabilities with fresh server time", async () => {
    const start = Date.now();
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { data } = await response.json();
    expect(Date.parse(data.serverTime)).toBeGreaterThanOrEqual(start);
    expect(data.android).toEqual({ minimumVersionCode: 1, latestVersionCode: 1, distribution: "private" });
    expect(data.evidence.timeZones).toContain("Asia/Makassar");
    expect(data.capabilities).toMatchObject({ offlineCapture: false, idempotentMutations: false, refreshSessions: false, pushNotifications: false });
  });
  it("supports public distribution later without allowing latest below minimum", async () => {
    vi.stubEnv("MOBILE_ANDROID_MIN_VERSION_CODE", "7");
    vi.stubEnv("MOBILE_ANDROID_LATEST_VERSION_CODE", "2");
    vi.stubEnv("MOBILE_DISTRIBUTION", "public");
    expect((await (await GET(request())).json()).data.android).toEqual({ minimumVersionCode: 7, latestVersionCode: 7, distribution: "public" });
  });
  it.each(["-1", "oops", "1.5", "Infinity"])("falls back safely for invalid version code %s", async value => {
    vi.stubEnv("MOBILE_ANDROID_MIN_VERSION_CODE", value);
    expect((await (await GET(request())).json()).data.android.minimumVersionCode).toBe(1);
  });
});
