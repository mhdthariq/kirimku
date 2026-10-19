import { db } from "@/infrastructure/persistence/db";
import type { AuthUser } from "@/infrastructure/auth/auth";
import { HttpError } from "@/shared/http-error";

export async function resolveWarehouseStaff(value: unknown, user: AuthUser): Promise<number | null> {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new HttpError(422, "Petugas Gudang tidak valid.");
  const employee = await db.employee.findUnique({ where: { id: value }, select: { id: true, isActive: true, warehouseId: true } });
  if (!employee?.isActive) throw new HttpError(422, "Petugas Gudang tidak ditemukan atau tidak aktif.");
  if (!user.isOwner && !user.permissions.includes("*") && (user.warehouseId == null || employee.warehouseId !== user.warehouseId)) throw new HttpError(403, "Petugas Gudang harus berasal dari gudang Anda.");
  return employee.id;
}
