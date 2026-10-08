import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), find: vi.fn(), list: vi.fn(), delete: vi.fn(), transaction: vi.fn(),
  wallet: vi.fn(), scans: vi.fn(), discrepancies: vi.fn(), details: vi.fn(), scope: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  masterShipment: { findUnique: mocks.find, findMany: mocks.list, delete: mocks.delete },
  walletTransaction: { count: mocks.wallet }, handoverScan: { count: mocks.scans },
  discrepancy: { count: mocks.discrepancies }, detailShipment: { findMany: mocks.details },
  warehouse: { findMany: async () => [] }, $transaction: mocks.transaction,
} }));
vi.mock("@/infrastructure/auth/auth", () => ({
  getAuthUser: mocks.auth,
  hasPermission: (user: { isOwner: boolean; permissions: string[] }, permission: string) => user.isOwner || user.permissions.includes(permission),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: mocks.audit, diffFields: vi.fn() }));
vi.mock("@/composition/pricing-server", () => ({ pricingPreview: vi.fn() }));
vi.mock("@/infrastructure/services/scan-flow", () => ({ paymentSummary: vi.fn() }));
vi.mock("@/infrastructure/services/shipment-totals", () => ({ computeTotals: vi.fn(), totalsByMaster: async () => new Map() }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: vi.fn(), nextDetailCodes: vi.fn() }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({
  assertShipmentScope: mocks.scope, cityIndex: async () => new Map(), inScope: () => true,
  shipmentGudangIds: () => [], scopeForUser: async () => null,
}));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: vi.fn(), runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { db } from "@/infrastructure/persistence/db";
import { HttpError } from "@/shared/http-error";
import { DELETE } from "@/app/api/v1/shipments/[id]/route";
import { GET } from "@/app/api/v1/shipments/route";

const counts = { invoiceLines: 0, payments: 0, pickups: 0, deliveries: 0, transportItems: 0 };
const shipment = { id: 12, masterCode: "MS-12", status: "CREATED", _count: counts };
const request = () => new NextRequest("http://localhost/api/v1/shipments/12", { method: "DELETE" });
const params = () => ({ params: Promise.resolve({ id: "12" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: 1, isOwner: false, permissions: ["shipment.delete", "shipment.view"] });
  mocks.find.mockResolvedValue(shipment);
  mocks.list.mockResolvedValue([]);
  mocks.wallet.mockResolvedValue(0);
  mocks.scans.mockResolvedValue(0);
  mocks.discrepancies.mockResolvedValue(0);
  mocks.details.mockResolvedValue([{ id: 20 }]);
  mocks.transaction.mockImplementation((fn) => fn(db));
});

describe("shipment deletion", () => {
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await DELETE(request(), params())).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("rejects actors without either delete permission before reading the shipment", async () => {
    mocks.auth.mockResolvedValue({ isOwner: false, permissions: [] });
    expect((await DELETE(request(), params())).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it.each([
    ["CREATED", "shipment.delete", 200],
    ["CREATED", "shipment.delete_cancelled", 403],
    ["CANCELLED", "shipment.delete", 403],
    ["CANCELLED", "shipment.delete_cancelled", 200],
  ])("%s requires its own permission (%s)", async (status, permission, expected) => {
    mocks.auth.mockResolvedValue({ isOwner: false, permissions: [permission] });
    mocks.find.mockResolvedValue({ ...shipment, status });
    const response = await DELETE(request(), params());
    expect(response.status).toBe(expected);
    expect(mocks.delete).toHaveBeenCalledTimes(expected === 200 ? 1 : 0);
    expect(mocks.audit).toHaveBeenCalledTimes(expected === 200 ? 1 : 0);
    if (expected === 200) {
      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ before: { id: 12, masterCode: "MS-12", status } }));
    }
  });
  it("allows owner bypass for cancelled shipments", async () => {
    mocks.auth.mockResolvedValue({ isOwner: true, permissions: [] });
    mocks.find.mockResolvedValue({ ...shipment, status: "CANCELLED" });
    expect((await DELETE(request(), params())).status).toBe(200);
  });
  it.each(["READY_FOR_PICKUP", "PICKED_UP", "IN_TRANSPORT", "DELIVERED"])("rejects status %s even for owners", async (status) => {
    mocks.auth.mockResolvedValue({ isOwner: true, permissions: [] });
    mocks.find.mockResolvedValue({ ...shipment, status });
    expect((await DELETE(request(), params())).status).toBe(422);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it.each(Object.keys(counts))("preserves linked %s records", async (relation) => {
    mocks.find.mockResolvedValue({ ...shipment, _count: { ...counts, [relation]: 1 } });
    expect((await DELETE(request(), params())).status).toBe(422);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["wallet", "scans", "discrepancies"] as const)("preserves non-FK %s history", async (kind) => {
    mocks[kind].mockResolvedValue(1);
    expect((await DELETE(request(), params())).status).toBe(422);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("checks scans referencing package IDs as well as the master", async () => {
    await DELETE(request(), params());
    expect(mocks.scans).toHaveBeenCalledWith({ where: { OR: [{ masterId: 12 }, { detailId: { in: [20] } }] } });
    expect(mocks.wallet).toHaveBeenCalledWith({ where: { referenceType: "shipment", referenceId: 12 } });
  });
  it("enforces shipment scope", async () => {
    mocks.scope.mockRejectedValue(new HttpError(403, "Outside scope"));
    expect((await DELETE(request(), params())).status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("returns 404 for missing shipments", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await DELETE(request(), params())).status).toBe(404);
  });
  it("returns conflict without auditing a concurrent write failure", async () => {
    mocks.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.11.1" }));
    expect((await DELETE(request(), params())).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("shipment invoice query", () => {
  it.each([["all", undefined], ["on_invoice", { some: {} }], ["not_invoice", { none: {} }]])("filters %s by invoice line existence, including cancelled invoices", async (filter, expected) => {
    expect((await GET(new NextRequest(`http://localhost/api/v1/shipments?invoice=${filter}`))).status).toBe(200);
    const where = mocks.list.mock.calls[0][0].where;
    expect(where.invoiceLines).toEqual(expected);
  });
  it("rejects invalid filters", async () => {
    expect((await GET(new NextRequest("http://localhost/api/v1/shipments?invoice=unknown"))).status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
