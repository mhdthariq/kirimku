import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "role.update");
    const { id } = await params;
    const existing = await db.role.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Role tidak ditemukan.");
    // System roles: only the owner may edit, and only their permission set.
    // Name/slug stay locked so seeded templates & code references remain stable.
    const editingSystem = existing.isSystem;
    if (editingSystem && !user.isOwner) {
      return fail(422, "Role sistem hanya bisa diubah oleh owner, dan hanya permission-nya.");
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (!editingSystem) {
      if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
      if (body.description !== undefined) data.description = str(body.description);
    } else if (body.description !== undefined) {
      data.description = str(body.description);
    }
    const role = await db.role.update({ where: { id: existing.id }, data });

    if (Array.isArray(body.permissionIds)) {
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      const permissionIds = body.permissionIds.map(Number).filter(Boolean);
      if (permissionIds.length > 0) {
        await db.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
      }
    }
    await audit({
      action: "updated",
      entityType: "role",
      entityId: role.id,
      entityLabel: role.name,
      actor: user,
      before: diffFields(existing, role as unknown as Record<string, unknown>),
      after: { permissionsUpdated: Array.isArray(body.permissionIds) },
    });
    const full = await db.role.findUnique({ where: { id: role.id }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
    return ok(full);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "role.delete");
    const { id } = await params;
    const existing = await db.role.findUnique({ where: { id: Number(id) }, include: { users: true } });
    if (!existing) return fail(404, "Role tidak ditemukan.");
    if (existing.isSystem) return fail(422, "Role sistem tidak bisa dihapus.");
    if (existing.users.length > 0) return fail(422, `Role masih dipakai oleh ${existing.users.length} user.`);
    await db.role.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "role", entityId: existing.id, entityLabel: existing.name, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
