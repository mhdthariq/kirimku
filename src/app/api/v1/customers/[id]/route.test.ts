import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), hasPermission: vi.fn(), find: vi.fn(), update: vi.fn(), delete: vi.fn(),
  count: vi.fn(), partner: vi.fn(), warehouse: vi.fn(), audit: vi.fn(), diffFields: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  customer: { findUnique: mocks.find, update: mocks.update, delete: mocks.delete },
  masterShipment: { count: mocks.count }, partner: { findUnique: mocks.partner }, warehouse: { findUnique: mocks.warehouse },
} }));
vi.mock("@/lib/auth", () => ({ getAuthUser: mocks.getAuthUser, hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/lib/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit, diffFields: mocks.diffFields }));
vi.mock("@/lib/license", () => ({ LicenseError: class extends Error {} }));
vi.mock("@/lib/tenant-context", () => ({ resolveTenantContext: vi.fn(),
  runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { GET, PUT, DELETE } from "./route";

const actor = { id: 7, name: "Alice", isOwner: false, permissions: ["customer.view", "customer.update", "customer.delete"], partnerType: "MARKETING", partnerId: 4 };
const customer = { id: 12, name: "Customer", marketingPartnerId: 4, isActive: true };
const params = () => ({ params: Promise.resolve({ id: "12" }) });
const request = (method = "GET", body?: unknown) => new NextRequest("http://localhost/api/v1/customers/12", {
  method, ...(method === "GET" || body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthUser.mockResolvedValue(actor);
  mocks.hasPermission.mockImplementation((user, permission) => user.isOwner || user.permissions.includes("*") || user.permissions.includes(permission));
  mocks.find.mockResolvedValue(customer);
  mocks.update.mockResolvedValue({ ...customer, name: "Updated" });
  mocks.count.mockResolvedValue(0);
  mocks.diffFields.mockReturnValue({ name: "Customer" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("/api/v1/customers/[id]", () => {
  it.each([GET, PUT, DELETE])("rejects unauthenticated requests before reading customer data", async (route) => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await route(request(route === PUT ? "PUT" : route === DELETE ? "DELETE" : "GET", {}), params());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Unauthenticated." });
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it.each([[GET, "customer.view"], [PUT, "customer.update"], [DELETE, "customer.delete"]] as const)("enforces %s route permission %s", async (route, permission) => {
    mocks.getAuthUser.mockResolvedValue({ ...actor, permissions: [] });
    const response = await route(request(route === PUT ? "PUT" : route === DELETE ? "DELETE" : "GET", {}), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: `Missing permission: ${permission}` });
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it.each([GET, PUT, DELETE])("denies marketing access to another partner's customer", async (route) => {
    mocks.find.mockResolvedValue({ ...customer, marketingPartnerId: 99 });
    const response = await route(request(route === PUT ? "PUT" : route === DELETE ? "DELETE" : "GET", {}), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Customer ini bukan milik Anda - data customer terpisah antar marketing." });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([GET, PUT, DELETE])("returns 404 for a missing customer", async (route) => {
    mocks.find.mockResolvedValue(null);
    const response = await route(request(route === PUT ? "PUT" : route === DELETE ? "DELETE" : "GET", {}), params());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Customer tidak ditemukan." });
  });
  it("returns flattened relation names without nested partner or warehouse objects", async () => {
    mocks.find.mockResolvedValue({ ...customer, shipments: [], marketingPartner: { user: { name: "Marketer" } }, warehouse: { name: "Depot" } });
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ...customer, shipments: [], marketingPartnerName: "Marketer", warehouseName: "Depot" } });
  });
  it.each([{ isOwner: true }, { permissions: ["*"] }])("allows owner/wildcard access across marketing scopes: %j", async (override) => {
    mocks.getAuthUser.mockResolvedValue({ ...actor, ...override });
    mocks.find.mockResolvedValue({ ...customer, marketingPartnerId: 99 });
    expect((await GET(request(), params())).status).toBe(200);
  });
  it("rejects an empty name without updating or auditing", async () => {
    const response = await PUT(request("PUT", { name: " " }), params());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "The name field is required.", errors: { name: ["The name field is required."] } });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("updates allowed marketing fields but ignores partner and warehouse reassignment", async () => {
    const response = await PUT(request("PUT", { name: " Updated ", phone: " ", marketingPartnerId: 99, warehouseId: 99 }), params());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { name: "Updated", phone: null } });
    expect(mocks.partner).not.toHaveBeenCalled();
    expect(mocks.warehouse).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "updated", entityId: 12, actor, before: { name: "Customer" } }));
  });
  it.each([null, { id: 9, type: "VEHICLE_OWNER", isActive: true }, { id: 9, type: "MARKETING", isActive: false }])("rejects an invalid admin marketing assignment: %j", async (partner) => {
    mocks.getAuthUser.mockResolvedValue({ ...actor, isOwner: true, partnerType: null });
    mocks.partner.mockResolvedValue(partner);
    const response = await PUT(request("PUT", { marketingPartnerId: 9 }), params());
    expect(response.status).toBe(422);
    expect((await response.json()).errors).toEqual({ marketingPartnerId: ["Marketing partner tidak valid."] });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["invalid", 9])("rejects invalid or inactive warehouse %s", async (warehouseId) => {
    mocks.getAuthUser.mockResolvedValue({ ...actor, partnerType: null });
    mocks.warehouse.mockResolvedValue({ id: 9, isActive: false });
    const response = await PUT(request("PUT", { warehouseId }), params());
    expect(response.status).toBe(422);
    expect((await response.json()).errors).toHaveProperty("warehouseId");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows an admin to assign active relations and clear the warehouse", async () => {
    mocks.getAuthUser.mockResolvedValue({ ...actor, partnerType: null });
    mocks.partner.mockResolvedValue({ id: 9, type: "MARKETING", isActive: true });
    expect((await PUT(request("PUT", { marketingPartnerId: "9", warehouseId: "general" }), params())).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { marketingPartnerId: 9, warehouseId: null } });
  });
  it("deactivates rather than deletes customers with shipment history", async () => {
    mocks.count.mockResolvedValue(2);
    mocks.update.mockResolvedValue({ ...customer, isActive: false });
    const response = await DELETE(request("DELETE"), params());
    expect(await response.json()).toEqual({ data: { deactivated: true, customer: { ...customer, isActive: false } } });
    expect(mocks.count).toHaveBeenCalledWith({ where: { customerId: 12 } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { isActive: false } });
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deactivated", entityId: 12 }));
  });
  it("deletes customers without shipments and records the prior state", async () => {
    const response = await DELETE(request("DELETE"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { deleted: true } });
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: 12 } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted", before: customer }));
  });
  it("returns a sanitized 500 when an update fails and does not audit success", async () => {
    mocks.update.mockRejectedValue(new Error("private database error"));
    const response = await PUT(request("PUT", { name: "Updated" }), params());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Internal server error." });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
