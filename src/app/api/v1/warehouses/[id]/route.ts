import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "warehouse.update");
    const { id } = await params;
    const existing = await db.warehouse.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Gudang tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
    if (body.city !== undefined) data.city = str(body.city);
    if (body.address !== undefined) data.address = str(body.address);
    if (body.latitude !== undefined) data.latitude = num(body.latitude);
    if (body.longitude !== undefined) data.longitude = num(body.longitude);
    if (body.notes !== undefined) data.notes = str(body.notes);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const warehouse = await db.warehouse.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "warehouse", entityId: warehouse.id, entityLabel: warehouse.name, actor: user, before: diffFields(existing, warehouse as unknown as Record<string, unknown>) });
    return ok(warehouse);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "warehouse.delete");
    const { id } = await params;
    const existing = await db.warehouse.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Gudang tidak ditemukan.");

    const referenced =
      (await db.masterShipment.count({ where: { originWarehouseId: existing.id } })) +
      (await db.masterShipment.count({ where: { destinationWarehouseId: existing.id } }));
    if (referenced > 0) {
      const warehouse = await db.warehouse.update({ where: { id: existing.id }, data: { isActive: false } });
      await audit({ action: "deactivated", entityType: "warehouse", entityId: warehouse.id, entityLabel: warehouse.name, actor: user });
      return ok({ deactivated: true, warehouse });
    }
    await db.warehouse.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "warehouse", entityId: existing.id, entityLabel: existing.name, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
