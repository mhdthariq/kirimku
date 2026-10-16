import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), mutate: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission) }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit }));
vi.mock("@/infrastructure/services/invoice-settlements", () => ({ mutateInvoiceSettlement: m.mutate }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: vi.fn(), runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { POST } from "@/app/api/v1/invoices/[id]/settlements/route";
import { PUT, DELETE } from "@/app/api/v1/invoices/[id]/settlements/[settlementId]/route";

const payload = { amount: 500_000, pph: 5_000, method: "TRANSFER", settledAt: "2026-10-16" };
const params = () => ({ params: Promise.resolve({ id: "1", settlementId: "10" }) });
const request = (method: string, body: unknown = payload) => new NextRequest("http://localhost/api/v1/invoices/1/settlements/10", { method, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ id: 2, permissions: ["payment.verify", "invoice.settlement.update", "invoice.settlement.delete"] });
  m.mutate.mockResolvedValue({ invoice: { id: 1, invoiceNumber: "INV-1", status: "SETTLED" }, settlement: { ...payload, id: 10 }, previous: null, commissionReleased: false });
});

describe("settlement API", () => {
  it("passes the full transfer and informational PPh without subtraction", async () => {
    expect((await POST(request("POST"), params())).status).toBe(200);
    expect(m.mutate).toHaveBeenCalledWith(1, 2, { type: "create", input: expect.objectContaining({ amount: 500_000, pph: 5_000 }) });
  });
  it.each([{ amount: -1 }, { pph: -1 }, { pph: 500_001 }, { amount: "invalid" }, { method: "INVALID" }, { settledAt: "invalid" }, { proofUrl: "https://example.com/proof" }, { proofUrl: "data:text/html;base64,AAAA" }])("rejects invalid payment input %j", async (override) => {
    expect((await POST(request("POST", { ...payload, ...override }), params())).status).toBe(422);
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it("preserves receipt when an edit omits proofUrl", async () => {
    expect((await PUT(request("PUT"), params())).status).toBe(200);
    expect(m.mutate.mock.calls[0][2].input).not.toHaveProperty("proofUrl");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "settlement_updated" }));
  });
  it("supports explicit receipt removal", async () => {
    await PUT(request("PUT", { ...payload, proofUrl: null }), params());
    expect(m.mutate.mock.calls[0][2].input.proofUrl).toBeNull();
  });
  it.each([["PUT", PUT], ["DELETE", DELETE], ["POST", POST]] as const)("requires the specific permission for %s", async (method, route) => {
    m.auth.mockResolvedValue({ id: 2, permissions: ["invoice.update", "invoice.view"] });
    expect((await route(request(method), params())).status).toBe(403);
    expect(m.mutate).not.toHaveBeenCalled();
  });
  it("deletes the requested settlement and retains an audit snapshot", async () => {
    m.mutate.mockResolvedValue({ invoice: { id: 1, invoiceNumber: "INV-1", status: "SENT" }, previous: { ...payload, id: 10 }, commissionReleased: false });
    expect((await DELETE(request("DELETE"), params())).status).toBe(200);
    expect(m.mutate).toHaveBeenCalledWith(1, 2, { type: "delete", settlementId: 10 });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "settlement_deleted", before: expect.objectContaining({ amount: 500_000, pph: 5_000 }) }));
  });
});
