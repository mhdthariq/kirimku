import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(), vehicle: vi.fn(), find: vi.fn(), list: vi.fn(), logs: vi.fn(), count: vi.fn(),
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), log: vi.fn(),
  walletFind: vi.fn(), walletCreate: vi.fn(), walletUpdate: vi.fn(), ledgerFind: vi.fn(), ledgerCreate: vi.fn(),
  audit: vi.fn(), transaction: vi.fn(), transport: vi.fn(),
}));
const tx = {
  vehicleRepair: { create: m.create, update: m.update, delete: m.remove },
  repairActionLog: { create: m.log },
  wallet: { findUnique: m.walletFind, create: m.walletCreate, update: m.walletUpdate },
  walletTransaction: { findUnique: m.ledgerFind, create: m.ledgerCreate },
};
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  vehicle: { findUnique: m.vehicle },
  vehicleRepair: { findUnique: m.find, findMany: m.list },
  repairActionLog: { findMany: m.logs, count: m.count },
  transport: { findUnique: m.transport },
  $transaction: m.transaction,
} }));
vi.mock("@/infrastructure/auth/auth", () => ({
  getAuthUser: m.auth,
  hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
vi.mock("@/infrastructure/services/wallet", () => ({ financeAudit: m.audit }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: async () => "REP-001" }));
import { GET, POST } from "@/app/api/v1/repairs/route";
import { PUT, DELETE } from "@/app/api/v1/repairs/[id]/route";
import { GET as GET_LOGS } from "@/app/api/v1/repairs/logs/route";

const body = { vehicleId: 1, description: "Ganti oli", amount: 100, proofUrl: "data:application/pdf;base64,cHJvb2Y=" };
const req = (method: string, payload?: unknown, query = "") => new NextRequest(`http://localhost/api/v1/repairs${query}`, {
  method, ...(payload ? { body: JSON.stringify(payload) } : {}),
});
const params = { params: Promise.resolve({ id: "1" }) };
function repair(ownerId: number | null) {
  return {
    ...body, id: 1, repairCode: "REP-001", ownerId, status: "VERIFIED",
    repairDate: new Date("2026-10-17"), deductedAmount: ownerId == null ? 0 : 100,
    walletTransactionId: ownerId == null ? null : 12,
    workshopVendor: null, notes: null, relatedTransportId: null,
    vehicle: { id: 1, vehicleNumber: "B 1000 CO" }, owner: ownerId == null ? null : { user: { name: "Partner" } },
  };
}
function expectNoWalletAccess() {
  for (const fn of [m.walletFind, m.walletCreate, m.walletUpdate, m.ledgerFind, m.ledgerCreate]) {
    expect(fn).not.toHaveBeenCalled();
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ id: 7, name: "Admin", permissions: ["repair.view", "repair.create", "repair.update", "repair.delete"] });
  m.vehicle.mockResolvedValue({ id: 1, vehicleNumber: "B 1000 CO", ownerId: null, owner: null });
  m.find.mockResolvedValue(repair(null));
  m.create.mockImplementation(async ({ data }) => ({ ...repair(data.ownerId), ...data }));
  m.update.mockImplementation(async ({ data }) => ({ ...repair(null), ...data }));
  m.transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  m.walletFind.mockResolvedValue({ id: 8, balance: 1000 });
  m.ledgerFind.mockResolvedValue(null);
  m.ledgerCreate.mockResolvedValue({ id: 12 });
  m.logs.mockResolvedValue([]);
  m.list.mockResolvedValue([]);
  m.count.mockResolvedValue(0);
});

it("creates a verified company repair with null ownership and no wallet access, ignoring client accounting fields", async () => {
  const response = await POST(req("POST", { ...body, ownerId: 99, deductedAmount: 100, walletTransactionId: 33 }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ ownerId: null, deductedAmount: 0, walletTransactionId: null, status: "VERIFIED" });
  expect(m.log).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: null, action: "CREATED", detail: expect.stringContaining("tanpa deduction wallet partner") }) });
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), "created", "repair", 1, "REP-001", expect.objectContaining({ immediatelyDeducted: false }));
  expectNoWalletAccess();
});

it("continues to debit and log partner repairs using server-side ownership", async () => {
  m.vehicle.mockResolvedValue({ id: 1, vehicleNumber: "B 2000 PA", ownerId: 9, owner: { id: 9 } });
  const response = await POST(req("POST", { ...body, ownerId: null }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ deductedAmount: 100, walletTransactionId: 12 });
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 9 }) });
  expect(m.walletFind).toHaveBeenCalledWith({ where: { partnerId: 9 } });
  expect(m.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ direction: "DEBIT", amount: 100, balanceAfter: 900, type: "REPAIR_DEDUCTION" }) });
  expect(m.walletUpdate).toHaveBeenCalledWith({ where: { id: 8 }, data: { balance: 900 } });
  expect(m.log).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 9, action: "CREATED" }) });
});

it.each([50, 200])("updates a company repair to %i without adjusting any wallet", async (amount) => {
  const response = await PUT(req("PUT", { ...body, amount, ownerId: 9 }), params);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ ownerId: null, deductedAmount: 0, amount });
  expect(m.log).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: null, action: "UPDATED" }) });
  expect(m.log.mock.calls[0][0].data.detail).not.toContain("wallet disesuaikan");
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), "updated", "repair", 1, "REP-001", expect.objectContaining({ walletAdjustment: 0 }));
  expectNoWalletAccess();
});

it.each([{ amount: 150, direction: "DEBIT", balance: 950 }, { amount: 50, direction: "CREDIT", balance: 1050 }])(
  "adjusts a partner repair to $amount with a $direction ledger entry", async ({ amount, direction, balance }) => {
    m.find.mockResolvedValue(repair(9));
    // The vehicle lookup is deliberately company-owned now: accounting follows the repair's original owner.
    const response = await PUT(req("PUT", { ...body, amount }), params);
    expect(response.status).toBe(200);
    expect(m.walletFind).toHaveBeenCalledWith({ where: { partnerId: 9 } });
    expect(m.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ direction, amount: 50, balanceAfter: balance }) });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deductedAmount: amount }) }));
  },
);

it("deletes a company repair with a surviving snapshot log and no refund", async () => {
  expect((await DELETE(req("DELETE"), params)).status).toBe(200);
  expectNoWalletAccess();
  expect(m.log).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: null, action: "DELETED", repairId: 1 }) });
  expect(m.log.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), "deleted", "repair", 1, "REP-001", expect.objectContaining({ refunded: 0 }));
});

it("refunds the partner deduction before deleting a partner repair", async () => {
  m.find.mockResolvedValue(repair(9));
  expect((await DELETE(req("DELETE"), params)).status).toBe(200);
  expect(m.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ direction: "CREDIT", amount: 100, balanceAfter: 1100 }) });
  expect(m.walletFind).toHaveBeenCalledWith({ where: { partnerId: 9 } });
  expect(m.log).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 9, action: "DELETED" }) });
});

it("still rejects partner deductions with insufficient funds", async () => {
  m.vehicle.mockResolvedValue({ id: 1, vehicleNumber: "B 2000 PA", ownerId: 9, owner: { id: 9 } });
  m.walletFind.mockResolvedValue({ id: 8, balance: 10 });
  expect((await POST(req("POST", body))).status).toBe(422);
  expect(m.ledgerCreate).not.toHaveBeenCalled();
  expect(m.log).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});

it.each([null, 9])("requires proof for ownership %s before starting a transaction", async (ownerId) => {
  m.vehicle.mockResolvedValue({ id: 1, ownerId });
  expect((await POST(req("POST", { ...body, proofUrl: null }))).status).toBe(422);
  expect(m.transaction).not.toHaveBeenCalled();
});

it("rejects missing vehicles and unrelated transports", async () => {
  m.vehicle.mockResolvedValueOnce(null);
  expect((await POST(req("POST", body))).status).toBe(404);
  m.transport.mockResolvedValue({ vehicleId: 2 });
  expect((await POST(req("POST", { ...body, relatedTransportId: 7 }))).status).toBe(422);
  expect(m.transaction).not.toHaveBeenCalled();
});

it("enforces repair permissions before mutations", async () => {
  m.auth.mockResolvedValue({ permissions: ["vehicle.view"] });
  expect((await POST(req("POST", body))).status).toBe(403);
  expect((await PUT(req("PUT", body), params)).status).toBe(403);
  expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  expect(m.transaction).not.toHaveBeenCalled();
});

it("keeps company records and logs out of partner views, even for an explicit repairId", async () => {
  m.auth.mockResolvedValue({ partnerType: "VEHICLE_OWNER", partnerId: 9, permissions: ["repair.view_own"] });
  expect((await GET(req("GET"))).status).toBe(200);
  expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 9 } }));
  expect((await GET_LOGS(req("GET", undefined, "?repairId=1"))).status).toBe(200);
  expect(m.logs).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 9, repairId: 1 } }));
  expect(m.count).toHaveBeenCalledWith({ where: { ownerId: 9, repairId: 1 } });
});

it("allows company viewers to list company repairs and their null-owner logs", async () => {
  m.list.mockResolvedValue([repair(null)]);
  m.logs.mockResolvedValue([{ id: 3, repairId: 1, ownerId: null, action: "CREATED", changes: null }]);
  expect((await (await GET(req("GET"))).json()).data[0].ownerId).toBeNull();
  expect((await (await GET_LOGS(req("GET"))).json()).data[0].ownerId).toBeNull();
  expect(m.logs).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
});
