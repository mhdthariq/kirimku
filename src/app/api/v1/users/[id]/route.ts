import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { ensurePartnerProfile } from "@/lib/partner";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "user.update");
    const { id } = await params;
    const existing = await db.user.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "User tidak ditemukan.");
    if (existing.isOwner) return fail(422, "Akun Owner tidak bisa diubah dari UI.");
    const body = await req.json().catch(() => ({}));

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
    if (body.password !== undefined && str(body.password)) {
      const password = String(body.password);
      if (password.length < 8) return fail(422, "Password minimal 8 karakter.", { password: ["Password minimal 8 karakter."] });
      data.passwordHash = hashPassword(password);
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.user.update({ where: { id: existing.id }, data });

    if (Array.isArray(body.roleIds)) {
      await db.userRole.deleteMany({ where: { userId: existing.id } });
      const assignedSlugs: string[] = [];
      for (const roleId of body.roleIds.map(Number).filter(Boolean)) {
        const role = await db.role.findUnique({ where: { id: roleId } });
        if (role) {
          await db.userRole.create({ data: { userId: existing.id, roleId } }).catch(() => undefined);
          assignedSlugs.push(role.slug);
        }
      }
      // Revise.md — granting a partner role provisions the partner + wallet.
      await ensurePartnerProfile(existing.id, assignedSlugs);
    }

    await audit({ action: "updated", entityType: "user", entityId: updated.id, entityLabel: updated.username, actor: user, after: { name: updated.name, roles: body.roleIds } });
    const full = await db.user.findUnique({ where: { id: updated.id }, include: { employee: true, roles: { include: { role: true } }, partner: true } });
    return ok({ ...full, passwordHash: undefined, partnerId: full?.partner?.id ?? null, partnerType: full?.partner?.type ?? null });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "user.disable");
    const { id } = await params;
    const existing = await db.user.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "User tidak ditemukan.");
    if (existing.isOwner) return fail(422, "Akun Owner tidak bisa dinonaktifkan.");
    const updated = await db.user.update({ where: { id: existing.id }, data: { isActive: false } });
    await db.sessionToken.deleteMany({ where: { userId: existing.id } });
    await audit({ action: "disabled", entityType: "user", entityId: existing.id, entityLabel: existing.username, actor: user });
    return ok({ disabled: true, user: { ...updated, passwordHash: undefined } });
  });
}
