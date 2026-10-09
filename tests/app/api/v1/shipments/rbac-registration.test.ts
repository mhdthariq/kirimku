import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), createMany: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  permission: { count: async () => 0, upsert: mocks.upsert, deleteMany: vi.fn(), findMany: async () => [] },
  role: { count: async () => 0, findMany: async () => [], upsert: async () => ({ id: 1 }) },
  rolePermission: { deleteMany: vi.fn(), createMany: mocks.createMany },
} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ tenantKey: () => "rbac-registration-test" }));
import { ensureRbac, PERMISSIONS, ROLE_TEMPLATES } from "@/infrastructure/auth/rbac";

it("automatically registers cancelled deletion without granting it to default non-owner roles", async () => {
  const permission = PERMISSIONS.find((p) => p.slug === "shipment.delete_cancelled");
  expect(permission).toBeDefined();
  expect(ROLE_TEMPLATES.filter((role) => role.slug !== "owner").every((role) => !role.permissions.includes("shipment.delete_cancelled"))).toBe(true);
  await ensureRbac();
  expect(mocks.upsert).toHaveBeenCalledWith({
    where: { slug: "shipment.delete_cancelled" }, create: permission,
    update: { module: permission!.module, description: permission!.description },
  });
});
