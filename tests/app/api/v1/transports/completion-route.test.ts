import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), scope: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { transport: { findUnique: m.find, updateMany: m.update } } }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: m.permission }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit }));
vi.mock("@/infrastructure/services/transport-ops-server", () => ({ assertTransportAccess: m.scope }));
vi.mock("@/infrastructure/http/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
import { POST } from "@/app/api/v1/transports/[id]/complete/route";
import { HttpError } from "@/shared/http-error";

const actor = { id: 7, username: "auditor.andi", isOwner: false, roles: [{ slug: "auditor", name: "Auditor" }], permissions: ["transport.complete"] };
const transport = { id: 10, transportCode: "TR-10", status: "ARRIVED", completedAt: null, route: null, shipments: [] };
const req = () => new NextRequest("http://localhost/api/v1/transports/10/complete", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ completedById: 999, completedByUsername: "forged", completedByRole: "Owner" }) });
const params = (id = "10") => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(actor); m.permission.mockReturnValue(true); m.find.mockResolvedValue(transport); m.update.mockResolvedValue({ count: 1 });
});

describe("transport audit completion", () => {
  it.each([401, 403])("enforces authentication and separate audit permission %s", async (status) => {
    if (status === 401) m.auth.mockResolvedValue(null); else m.permission.mockReturnValue(false);
    expect((await POST(req(), params())).status).toBe(status);
    expect(m.find).not.toHaveBeenCalled();
    if (status === 403) expect(m.permission).toHaveBeenCalledWith(actor, "transport.complete");
  });
  it.each(["PLANNED", "DEPARTED", "COMPLETED", "CANCELLED"])("rejects state %s", async (status) => {
    m.find.mockResolvedValue({ ...transport, status });
    expect((await POST(req(), params())).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "bad"])("rejects invalid ID %s", async (id) => {
    expect((await POST(req(), params(id))).status).toBe(422);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("returns missing transport", async () => {
    m.find.mockResolvedValue(null);
    expect((await POST(req(), params())).status).toBe(404);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("enforces transport scope before mutation", async () => {
    m.scope.mockRejectedValue(new HttpError(403, "Outside warehouse scope"));
    expect((await POST(req(), params())).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("requires a successful conditional transition before auditing", async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect((await POST(req(), params())).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("completes only ARRIVED and stores trusted reviewer metadata without changing packages or arrival", async () => {
    const response = await POST(req(), params());
    expect(response.status).toBe(200);
    const completion = { status: "COMPLETED", completedAt: expect.any(Date), completedById: 7, completedByUsername: actor.username, completedByRole: "Auditor" };
    expect(m.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 10, status: "ARRIVED", completedAt: null }, data: completion });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "complete", actor, before: { status: "ARRIVED" }, after: completion }));
    expect((await response.json()).data).toMatchObject({ id: 10, status: "COMPLETED", completedByUsername: actor.username });
  });
  it("stores Owner explicitly and sorts role snapshots", async () => {
    m.auth.mockResolvedValue({ ...actor, isOwner: true });
    await POST(req(), params());
    expect(m.update.mock.calls[0][0].data.completedByRole).toBe("Owner");
    m.auth.mockResolvedValue({ ...actor, roles: [{ name: "Reviewer" }, { name: "Auditor" }] });
    await POST(req(), params());
    expect(m.update.mock.calls[1][0].data.completedByRole).toBe("Auditor, Reviewer");
  });
});
