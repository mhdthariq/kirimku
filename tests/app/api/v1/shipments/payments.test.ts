import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), scope: vi.fn(), audit: vi.fn(), master: vi.fn(), customer: vi.fn(), createMaster: vi.fn(), tracking: vi.fn(), findPayments: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(), updated: vi.fn(), transaction: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  masterShipment: { findUnique: m.master, create: m.createMaster }, customer: { findUnique: m.customer },
  trackingEvent: { create: m.tracking }, payment: { findMany: m.findPayments, create: m.create, findUnique: m.find, updateMany: m.update, findUniqueOrThrow: m.updated }, $transaction: m.transaction,
} }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: (u: { isOwner: boolean; permissions: string[] }, p: string) => u.isOwner || u.permissions.includes(p) }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: m.scope }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: async () => "MKT-1", nextDetailCodes: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
import { db } from "@/infrastructure/persistence/db";
import { HttpError } from "@/shared/http-error";
import { POST as record, GET as history } from "@/app/api/v1/shipments/[id]/payments/route";
import { POST as verify } from "@/app/api/v1/payments/[id]/verify/route";
import { POST as reject } from "@/app/api/v1/payments/[id]/reject/route";
import { POST as createShipment } from "@/app/api/v1/shipments/route";
import { paymentSummary } from "@/infrastructure/services/scan-flow";

const actor = { id: 7, name: "Admin", isOwner: false, permissions: ["shipment.create", "payment.view"], roles: [{ slug: "admin-gudang" }], partnerType: null };
const master = { id: 12, masterCode: "MKT-12", priceAmount: 100000, finalPriceAmount: 90000, status: "CREATED", paymentTrackingEnabled: true, customer: { type: "b2c" } };
const params = { params: Promise.resolve({ id: "12" }) };
const request = (body: unknown = { method: "CASH", amount: 90000 }) => new NextRequest("http://localhost/api/v1/shipments/12/payments", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(actor);
  m.master.mockResolvedValue(master);
  m.customer.mockResolvedValue({ id: 2, type: "b2c" });
  m.createMaster.mockResolvedValue(master);
  m.transaction.mockImplementation((fn) => fn(db));
  m.findPayments.mockResolvedValue([]);
  m.create.mockResolvedValue({ id: 20, status: "RECORDED" });
  m.find.mockResolvedValue({ id: 20, masterId: 12, amount: 90000, status: "RECORDED", master });
  m.update.mockResolvedValue({ count: 1 });
  m.updated.mockResolvedValue({ id: 20, status: "VERIFIED", master: { masterCode: "MKT-12" } });
});

describe("trusted creator payment eligibility", () => {
  it.each([
    ["b2c", "admin-gudang", null, true], ["b2b", "admin-gudang", null, false],
    ["b2c", "admin-kantor", null, false], ["b2c", "marketing", "MARKETING", false],
    ["b2c", "admin-gudang", "MARKETING", false],
  ])("%s by %s / %s stamps tracking=%s, ignoring forged client input", async (type, role, partnerType, enabled) => {
    m.auth.mockResolvedValue({ ...actor, roles: [{ slug: role }], partnerType });
    m.customer.mockResolvedValue({ id: 2, type });
    const response = await createShipment(request({ customerId: 2, origin: "Medan", destination: "Aceh", paymentTrackingEnabled: !enabled }));
    expect(response.status).toBe(200);
    expect(m.createMaster).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentTrackingEnabled: enabled }) }));
  });
});

describe("shipment payment recording", () => {
  it("stores optional payment proof and rejects unsupported proof formats", async () => {
    const proof = "data:image/jpeg;base64,QUJD";
    expect((await record(request({ method: "CASH", amount: 100, proof }), params)).status).toBe(200);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proofUrl: proof, method: "CASH" }) }));
    m.create.mockClear();
    expect((await record(request({ method: "CASH", amount: 100, proof: "javascript:alert(1)" }), params)).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    m.auth.mockResolvedValue(null);
    expect((await record(request(), params)).status).toBe(401);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("permits scoped Admin Gudang without global record permission, never trusting supplied status/actor", async () => {
    expect((await record(request({ method: "TRANSFER", amount: 50000, status: "VERIFIED", recordedById: 999 }), params)).status).toBe(200);
    expect(m.scope).toHaveBeenCalledWith(actor, master);
    expect(m.create).toHaveBeenCalledWith({ data: { masterId: 12, method: "TRANSFER", amount: 50000, status: "RECORDED", reference: null, proofUrl: null, recordedById: 7 } });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it.each([false, undefined])("permits scoped Admin Gudang for legacy B2C shipments (%s)", async (enabled) => {
    m.master.mockResolvedValue({ ...master, paymentTrackingEnabled: enabled });
    expect((await record(request(), params)).status).toBe(200);
    expect(m.create).toHaveBeenCalledOnce();
  });
  it("does not grant staff or marketing the Admin Gudang exception", async () => {
    m.auth.mockResolvedValue({ ...actor, roles: [{ slug: "staff-gudang" }] });
    expect((await record(request(), params)).status).toBe(403);
    expect(m.master).not.toHaveBeenCalled();
  });
  it("enforces warehouse scope before writes", async () => {
    m.scope.mockRejectedValue(new HttpError(403, "Outside scope"));
    expect((await record(request(), params)).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("preserves existing record permission for non-tracked B2C", async () => {
    m.auth.mockResolvedValue({ ...actor, roles: [], permissions: ["payment.record"] });
    m.master.mockResolvedValue({ ...master, paymentTrackingEnabled: false });
    expect((await record(request(), params)).status).toBe(200);
  });
  it("rejects B2B even for owner; invoice flow only", async () => {
    m.auth.mockResolvedValue({ ...actor, isOwner: true });
    m.master.mockResolvedValue({ ...master, customer: { type: "b2b" } });
    expect((await record(request(), params)).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([{ method: "OTHER", amount: 1 }, { method: "CASH", amount: 0 }, { method: "CASH", amount: -1 }, { method: "CASH", amount: "Infinity" }, { method: "CASH", amount: "NaN" }, { method: "CASH", amount: 90001 }])("rejects invalid payment %j", async (body) => {
    expect((await record(request(body), params)).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([{ priceAmount: null, finalPriceAmount: null }, { status: "CANCELLED" }])("rejects unpriced/cancelled shipments %j", async (fields) => {
    m.master.mockResolvedValue({ ...master, ...fields });
    expect((await record(request(), params)).status).toBe(422);
  });
  it("checks discounted outstanding inside transaction", async () => {
    m.findPayments.mockResolvedValue([{ amount: 10000 }]);
    expect((await record(request(), params)).status).toBe(422);
    expect(m.findPayments).toHaveBeenCalledWith({ where: { masterId: 12, status: "VERIFIED" }, select: { amount: true } });
  });
  it("returns retryable conflict on concurrent writes without auditing", async () => {
    m.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Conflict", { code: "P2034", clientVersion: "6.11.1" }));
    expect((await record(request(), params)).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("history selects only public recorder/verifier names", async () => {
    expect((await history(request(), params)).status).toBe(200);
    expect(m.findPayments).toHaveBeenCalledWith(expect.objectContaining({ include: { recordedBy: { select: { name: true } }, verifiedBy: { select: { name: true } } } }));
  });
});

describe("payment verification", () => {
  beforeEach(() => m.auth.mockResolvedValue({ ...actor, permissions: ["payment.verify"] }));
  it("does not allow Admin Gudang to self-verify without verification permission", async () => {
    m.auth.mockResolvedValue(actor);
    expect((await verify(request(), params)).status).toBe(403);
  });
  it("verifies once with a conditional state transition and serializable balance check", async () => {
    expect((await verify(request(), params)).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 20, status: "RECORDED" }, data: expect.objectContaining({ status: "VERIFIED", verifiedById: 7 }) }));
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("cannot verify a second pending payment that would overpay", async () => {
    m.findPayments.mockResolvedValue([{ amount: 50000 }]);
    expect((await verify(request(), params)).status).toBe(422);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each(["VERIFIED", "REJECTED"])("cannot verify %s", async (status) => {
    m.find.mockResolvedValue({ id: 20, status, master });
    expect((await verify(request(), params)).status).toBe(422);
  });
  it("cannot verify B2B", async () => {
    m.find.mockResolvedValue({ id: 20, status: "RECORDED", master: { ...master, customer: { type: "b2b" } } });
    expect((await verify(request(), params)).status).toBe(422);
  });
  it("enforces scope on verification", async () => {
    m.scope.mockRejectedValue(new HttpError(403, "Outside scope"));
    expect((await verify(request(), params)).status).toBe(403);
  });
  it.each([verify, reject])("returns conflict if another verifier already decided", async (decide) => {
    m.update.mockResolvedValue({ count: 0 });
    expect((await decide(request(), params)).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("shared operational summary", () => {
  it("queries VERIFIED only; pending is not paid", async () => {
    m.findPayments.mockResolvedValue([{ amount: 30000 }]);
    const summary = await paymentSummary(12);
    expect(m.findPayments).toHaveBeenCalledWith({ where: { masterId: 12, status: "VERIFIED" }, select: { amount: true } });
    expect(summary).toMatchObject({ paidAmount: 30000, remainingAmount: 60000, status: "DP", dpOk: true });
  });
});
