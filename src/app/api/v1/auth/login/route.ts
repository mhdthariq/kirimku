import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { ensureRbac } from "@/lib/rbac";
import { ensureSeed } from "@/lib/seed";
import { audit } from "@/lib/audit";
import { ok, fail, handle, requireStr } from "@/lib/api-helpers";
import type { AuthUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  return handle(async () => {
    await ensureRbac();
    await ensureSeed();
    const body = await req.json().catch(() => ({}));
    const username = requireStr(body.username, "username");
    const password = requireStr(body.password, "password");

    const user = await db.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { employee: { include: { warehouse: true } } },
    });

    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      return fail(401, "Username atau password salah.");
    }

    const { token, expiresAt } = await createSession(user.id);

    const roles = await db.userRole.findMany({
      where: { userId: user.id },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const permissions = user.isOwner
      ? ["*"]
      : Array.from(new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permission.slug))));

    const sessionUser: AuthUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      isOwner: user.isOwner,
      isActive: user.isActive,
      employeeId: user.employeeId,
      warehouseId: user.employee?.warehouseId ?? null,
      warehouseName: user.employee?.warehouse?.name ?? null,
      roles: roles.map((r) => ({ id: r.role.id, slug: r.role.slug, name: r.role.name })),
      permissions,
    };

    await audit({ action: "login", entityType: "auth", entityLabel: user.username, actor: sessionUser });

    return ok({ token, expiresAt: expiresAt.toISOString(), user: sessionUser });
  });
}
