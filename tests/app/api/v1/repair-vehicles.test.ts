import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { vehicle: { findMany: m.list } } }));
vi.mock("@/infrastructure/auth/auth", () => ({
  getAuthUser: m.auth,
  hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
  resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false,
}));
import { GET } from "@/app/api/v1/repairs/vehicles/route";
const req = () => new NextRequest("http://localhost/api/v1/repairs/vehicles");

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ id: 1, permissions: ["repair.create"] });
});

it("returns company and partner choices for repair creators without vehicle.view", async () => {
  const vehicles = [{ id: 1, vehicleNumber: "B 1000 CO", ownerId: null }, { id: 2, vehicleNumber: "B 2000 PA", ownerId: 9 }];
  m.list.mockResolvedValue(vehicles);
  const response = await GET(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: vehicles });
  expect(m.list).toHaveBeenCalledWith({
    select: { id: true, vehicleNumber: true, ownerId: true }, orderBy: { vehicleNumber: "asc" },
  });
});

it("returns an empty list when no vehicles exist", async () => {
  m.list.mockResolvedValue([]);
  expect(await (await GET(req())).json()).toEqual({ data: [] });
});

it("rejects vehicle viewers and repair viewers without repair.create", async () => {
  m.auth.mockResolvedValue({ id: 1, permissions: ["vehicle.view", "repair.view"] });
  expect((await GET(req())).status).toBe(403);
  expect(m.list).not.toHaveBeenCalled();
});

it("rejects unauthenticated requests before loading vehicles", async () => {
  m.auth.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(401);
  expect(m.list).not.toHaveBeenCalled();
});
