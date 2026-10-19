import { beforeEach, expect, it, vi } from "vitest";
import type { AuthUser } from "@/infrastructure/auth/auth";
const { find } = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { employee: { findUnique: find } } }));
import { resolveWarehouseStaff } from "@/infrastructure/services/transport-warehouse-staff";
const user = { isOwner: false, permissions: [], warehouseId: 2 } as unknown as AuthUser;
beforeEach(() => { find.mockReset(); });
it("permits clearing staff and validates assigned active staff in the user's warehouse", async () => {
  expect(await resolveWarehouseStaff(null, user)).toBeNull();
  expect(find).not.toHaveBeenCalled();
  find.mockResolvedValue({ id: 7, isActive: true, warehouseId: 2 });
  expect(await resolveWarehouseStaff(7, user)).toBe(7);
  find.mockResolvedValue({ id: 7, isActive: false, warehouseId: 2 });
  await expect(resolveWarehouseStaff(7, user)).rejects.toThrow("tidak aktif");
  find.mockResolvedValue({ id: 7, isActive: true, warehouseId: 3 });
  await expect(resolveWarehouseStaff(7, user)).rejects.toThrow("gudang Anda");
  expect(await resolveWarehouseStaff(7, { ...user, isOwner: true })).toBe(7);
  await expect(resolveWarehouseStaff("7", user)).rejects.toThrow("tidak valid");
});
