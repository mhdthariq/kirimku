import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/infrastructure/auth/auth";

const mocks = vi.hoisted(() => ({ employee: vi.fn(), warehouses: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  employee: { findUnique: mocks.employee }, warehouse: { findMany: mocks.warehouses },
} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ tenantKey: () => "test" }));
import { ROLE_TEMPLATES } from "@/infrastructure/auth/rbac";
import { assertTransportAccess } from "@/infrastructure/services/transport-ops-server";

const transport = { driverId: null, kenekId: null, route: { origin: "Medan", destination: "Banda Aceh" }, shipments: [] };
function financeUser(slug: string): AuthUser {
  const role = ROLE_TEMPLATES.find((r) => r.slug === slug)!;
  return { id: 7, username: "finance", name: "Finance", isOwner: false, isActive: true,
    employeeId: 9, warehouseId: 1, warehouseName: "Medan", partnerId: null, partnerType: null,
    roles: [{ id: 2, slug, name: role.name }], permissions: role.permissions };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.employee.mockResolvedValue({ warehouseId: 1 });
  mocks.warehouses.mockResolvedValue([{ id: 1, city: "Medan" }, { id: 2, city: "Banda Aceh" }, { id: 3, city: "Jakarta" }]);
});

describe.each(["admin-kantor", "admin-finance"])("expense approval warehouse scope: %s", (slug) => {
  it.each([1, 2])("allows the route endpoint warehouse %s", async (warehouseId) => {
    mocks.employee.mockResolvedValue({ warehouseId });
    await expect(assertTransportAccess(financeUser(slug), transport)).resolves.toBeUndefined();
  });
  it("does not turn finance approval and transport.view into cross-warehouse access", async () => {
    mocks.employee.mockResolvedValue({ warehouseId: 3 });
    await expect(assertTransportAccess(financeUser(slug), transport)).rejects.toMatchObject({ status: 403 });
  });
  it("denies an account without an employee binding", async () => {
    await expect(assertTransportAccess({ ...financeUser(slug), employeeId: null }, transport)).rejects.toMatchObject({ status: 403 });
    expect(mocks.employee).not.toHaveBeenCalled();
  });
  it("denies an employee without a warehouse", async () => {
    mocks.employee.mockResolvedValue({ warehouseId: null });
    await expect(assertTransportAccess(financeUser(slug), transport)).rejects.toMatchObject({ status: 403 });
  });
  it("also recognizes warehouses of shipments riding the transport", async () => {
    mocks.employee.mockResolvedValue({ warehouseId: 3 });
    const shipments = [{ master: { status: "IN_TRANSPORT", originWarehouseId: 3, destinationWarehouseId: 2,
      arrivedWarehouseId: null, origin: "Jakarta", destination: "Banda Aceh" } }];
    await expect(assertTransportAccess(financeUser(slug), { ...transport, shipments })).resolves.toBeUndefined();
  });
});
describe("expense Owner access", () => {
  it("retains unrestricted access without an employee or warehouse", async () => {
    await expect(assertTransportAccess({ ...financeUser("admin-finance"), isOwner: true, employeeId: null, warehouseId: null }, transport)).resolves.toBeUndefined();
    expect(mocks.employee).not.toHaveBeenCalled();
    expect(mocks.warehouses).not.toHaveBeenCalled();
  });
});
