import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/partners/{id}/profile — edit a partner's user-account details
 * (name, password, active status). Marketing & Vehicle Owner partners have no
 * relation to the Employee table, so this endpoint manages only the underlying
 * User account. Every change is recorded as an audit entry with
 * entityType="partner" so the Partners tab has its own clear activity trail.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "user.update");
    const { id } = await params;
    const partner = await db.partner.findUnique({
      where: { id: Number(id) },
      include: { user: { select: { id: true, username: true, name: true, isActive: true } } },
    });
    if (!partner) return fail(404, "Partner tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    const before = { name: partner.user.name, isActive: partner.user.isActive };

    if (body.name !== undefined) {
      const name = str(body.name);
      if (!name) return fail(422, "Nama tidak boleh kosong.", { name: ["Nama tidak boleh kosong."] });
      if (name !== partner.user.name) {
        changes.name = { before: partner.user.name, after: name };
        data.name = name;
      }
    }

    if (body.password !== undefined && str(body.password)) {
      const password = String(body.password);
      if (password.length < 8) {
        return fail(422, "Password minimal 8 karakter.", { password: ["Password minimal 8 karakter."] });
      }
      data.passwordHash = hashPassword(password);
      // Never log the actual password — record only that it was changed.
      changes.password = { before: "[hidden]", after: "[changed]" };
    }

    if (body.isActive !== undefined) {
      const isActive = Boolean(body.isActive);
      if (isActive !== partner.user.isActive) {
        changes.isActive = { before: partner.user.isActive, after: isActive };
        data.isActive = isActive;
      }
    }

    if (Object.keys(data).length === 0) {
      return ok({ id: partner.id, userId: partner.user.id, name: partner.user.name, username: partner.user.username, isActive: partner.user.isActive, unchanged: true });
    }

    const updated = await db.user.update({ where: { id: partner.user.id }, data });

    // Kill active sessions when disabling so the partner is logged out immediately.
    if (body.isActive === false) {
      await db.sessionToken.deleteMany({ where: { userId: partner.user.id } });
    }

    await audit({
      action: "updated_profile",
      entityType: "partner",
      entityId: partner.id,
      entityLabel: partner.user.username,
      actor: user,
      before,
      after: changes,
    });

    // Dedicated password-change audit entry — same pattern as the admin
    // /users/{id} path. The entityLabel spells out WHO changed WHOSE
    // password so the audit timeline is readable at a glance.
    if (changes.password) {
      await audit({
        action: "change_password",
        entityType: "partner",
        entityId: partner.id,
        entityLabel: `${user.name} change password ${partner.user.username}`,
        actor: user,
        after: {
          changedBy: user.name,
          changedByUsername: user.username,
          targetUser: partner.user.username,
        },
      });
    }

    return ok({
      id: partner.id,
      userId: updated.id,
      name: updated.name,
      username: updated.username,
      isActive: updated.isActive,
    });
  });
}

/**
 * DELETE /api/v1/partners/{id}/profile — disable a partner's user account.
 * Sessions are revoked so the partner is logged out immediately. The partner
 * profile + wallet are left intact (historical data must remain queryable).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "user.disable");
    const { id } = await params;
    const partner = await db.partner.findUnique({
      where: { id: Number(id) },
      include: { user: { select: { id: true, username: true, name: true, isActive: true, isOwner: true } } },
    });
    if (!partner) return fail(404, "Partner tidak ditemukan.");
    if (partner.user.isOwner) return fail(422, "Akun Owner tidak bisa dinonaktifkan.");

    const updated = await db.user.update({ where: { id: partner.user.id }, data: { isActive: false } });
    await db.sessionToken.deleteMany({ where: { userId: partner.user.id } });

    await audit({
      action: "disabled",
      entityType: "partner",
      entityId: partner.id,
      entityLabel: partner.user.username,
      actor: user,
      before: { name: partner.user.name, isActive: partner.user.isActive },
      after: { isActive: false },
    });

    return ok({ disabled: true, userId: updated.id });
  });
}
