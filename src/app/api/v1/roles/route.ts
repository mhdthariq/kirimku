import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, slugify, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "role.view");
    const roles = await db.role.findMany({
      orderBy: { id: "asc" },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    return ok(roles);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "role.create");
    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");
    const slug = slugify(name);
    if (!slug) return fail(422, "Nama role harus menghasilkan slug yang valid.", { name: ["Nama role harus menghasilkan slug yang valid."] });
    const existing = await db.role.findUnique({ where: { slug } });
    if (existing) return fail(422, `Role slug "${slug}" sudah dipakai.`, { slug: ["Slug sudah dipakai."] });

    const role = await db.role.create({ data: { slug, name, description: str(body.description), isSystem: false } });
    const permissionIds = Array.isArray(body.permissionIds) ? body.permissionIds.map(Number).filter(Boolean) : [];
    if (permissionIds.length > 0) {
      await db.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    await audit({ action: "created", entityType: "role", entityId: role.id, entityLabel: role.name, actor: user, after: { slug, permissions: permissionIds.length } });
    const full = await db.role.findUnique({ where: { id: role.id }, include: { permissions: { include: { permission: true } } } });
    return ok(full);
  });
}
