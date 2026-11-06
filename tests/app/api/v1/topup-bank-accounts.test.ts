import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), banks: vi.fn(), topups: vi.fn(), partner: vi.fn(), create: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  bankAccount: { findMany: m.banks },
  topUpRequest: { findMany: m.topups, create: m.create },
  partner: { findFirst: m.partner },
} }));
vi.mock("@/infrastructure/auth/auth", () => ({
  getAuthUser: m.auth,
  hasPermission: (user: { isOwner: boolean; permissions: string[] }, permission: string) => user.isOwner || user.permissions.includes(permission),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
vi.mock("@/infrastructure/services/wallet", () => ({ financeAudit: vi.fn() }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: async () => "TOP-TEST" }));

import { GET, POST } from "@/app/api/v1/topups/route";

const accounts = [
  { id: 1, bankName: "BCA", accountNumber: "00123456", accountName: "Company A" },
  { id: 2, bankName: "BNI", accountNumber: "00987654", accountName: "Company B" },
];
const selection = {
  where: { isActive: true }, orderBy: [{ bankName: "asc" }, { id: "asc" }],
  select: { id: true, bankName: true, accountNumber: true, accountName: true },
};
const request = () => new NextRequest("http://localhost/api/v1/topups", { method: "POST", body: JSON.stringify({ partnerId: 2, amount: 10000, proofUrl: "data:image/png;base64,AAA=" }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ id: 1, isOwner: true, permissions: [] });
  m.banks.mockResolvedValue(accounts);
  m.topups.mockResolvedValue([]);
  m.partner.mockResolvedValue({ id: 2 });
  m.create.mockResolvedValue({ id: 3 });
});

describe("top-up transfer accounts", () => {
  it.each(["owner", "marketing"])("uses active master accounts for %s without requiring master-management permission", async (role) => {
    if (role === "marketing") m.auth.mockResolvedValue({ id: 2, partnerId: 2, partnerType: "MARKETING", isOwner: false, permissions: [] });
    const response = await GET(new NextRequest("http://localhost/api/v1/topups"));
    expect(await response.json()).toEqual({ data: { topUps: [], bankAccounts: accounts } });
    expect(m.banks).toHaveBeenCalledWith(selection);
  });

  it("returns an empty list when no active master exists", async () => {
    m.banks.mockResolvedValue([]);
    const response = await GET(new NextRequest("http://localhost/api/v1/topups"));
    expect((await response.json()).data.bankAccounts).toEqual([]);
  });

  it("returns the same account selection on creation", async () => {
    const response = await POST(request());
    expect(await response.json()).toEqual({ data: { topUp: { id: 3 }, bankAccounts: accounts } });
    expect(m.banks).toHaveBeenCalledWith(selection);
  });

  it("does not disclose transfer accounts to an unauthorized user", async () => {
    m.auth.mockResolvedValue({ id: 4, isOwner: false, permissions: [] });
    expect((await GET(new NextRequest("http://localhost/api/v1/topups"))).status).toBe(403);
    expect(m.banks).not.toHaveBeenCalled();
  });

  it("does not create a top-up if the master lookup fails", async () => {
    m.banks.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(m.create).not.toHaveBeenCalled();
  });
});
