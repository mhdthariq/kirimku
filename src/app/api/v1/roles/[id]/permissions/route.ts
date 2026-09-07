import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Replace the full permission set of a role. */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "role.update");
    const { id } = await params;
    const role = await db.role.findUnique({ where: { id: Number(id) } });
    if (!role) return fail(404, "Role tidak ditemukan.");
    if (role.isSystem) return fail(422, "Permission role sistem tidak bisa diubah dari UI. Buat role baru untuk kustomisasi.");

    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.permissionIds)) return fail(422, "permissionIds wajib berupa array.");
    const permissionIds = body.permissionIds.map(Number).filter(Boolean);
    for (const permissionId of permissionIds) {
      const permission = await db.permission.findUnique({ where: { id: permissionId } });
      if (!permission) return fail(422, `Permission id ${permissionId} tidak ditemukan.`);
    }

    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissionIds.length > 0) {
      await db.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
    }
    await audit({ action: "updated", entityType: "role", entityId: role.id, entityLabel: `${role.name} · permissions`, actor: user, after: { permissionIds } });
    return ok({ updated: true, permissionCount: permissionIds.length });
  });
}
