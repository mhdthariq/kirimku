import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { ensurePartnerProfile } from "@/lib/partner";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
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
      const roleIds = body.roleIds.map(Number).filter(Boolean);
      const selectedRoles = roleIds.length > 0 ? await db.role.findMany({ where: { id: { in: roleIds } }, select: { slug: true } }) : [];
      if (existing.employeeId && selectedRoles.some((role) => role.slug === "marketing" || role.slug === "vehicle-owner")) {
        return fail(422, "Partner Marketing / Vehicle Owner tidak boleh terhubung ke employee.", { roleIds: ["Partner tidak boleh terhubung ke employee."] });
      }
      await db.userRole.deleteMany({ where: { userId: existing.id } });
      const assignedSlugs: string[] = [];
      for (const roleId of roleIds) {
        const role = await db.role.findUnique({ where: { id: roleId } });
        if (role) {
          await db.userRole.create({ data: { userId: existing.id, roleId } }).catch(() => undefined);
          assignedSlugs.push(role.slug);
        }
      }
      // Revise.md — granting a partner role provisions the partner + wallet.
      // Revise round 10 — also forward warehouseId so the user edit form can
      // change the marketing partner's gudang alignment (when roleIds is sent
      // together with warehouseId). If only warehouseId changed (without
      // roleIds), we still need to re-call ensurePartnerProfile so it updates
      // the alignment — we use the EXISTING assignedSlugs in that case.
      const slugsForProfile = assignedSlugs.length > 0
        ? assignedSlugs
        : (await db.userRole.findMany({ where: { userId: existing.id }, include: { role: { select: { slug: true } } } })).map((ur) => ur.role.slug);
      // Compute partnerWarehouseId from body.warehouseId (same logic as POST).
      let partnerWarehouseId: number | null | undefined = undefined;
      if (body.warehouseId !== undefined) {
        const raw = body.warehouseId;
        if (raw === null || raw === "" || raw === "general" || raw === "none") {
          partnerWarehouseId = null;
        } else {
          const wid = num(raw);
          if (wid == null) {
            return fail(422, "Gudang tidak valid.", { warehouseId: ["Gudang tidak valid."] });
          }
          partnerWarehouseId = wid;
        }
      }
      try {
        await ensurePartnerProfile(existing.id, slugsForProfile, { warehouseId: partnerWarehouseId });
      } catch (e) {
        if (e instanceof Error && e.message === "WAREHOUSE_NOT_FOUND") {
          return fail(422, "Gudang tidak ditemukan / tidak aktif.", { warehouseId: ["Gudang tidak ditemukan / tidak aktif."] });
        }
        throw e;
      }
    } else if (body.warehouseId !== undefined) {
      // Revise round 10 — warehouseId can be updated standalone (without
      // roleIds). Use the existing role slugs to invoke ensurePartnerProfile
      // — it will update the warehouseId on the partner profile.
      const existingSlugs = (await db.userRole.findMany({ where: { userId: existing.id }, include: { role: { select: { slug: true } } } })).map((ur) => ur.role.slug);
      let partnerWarehouseId: number | null;
      const raw = body.warehouseId;
      if (raw === null || raw === "" || raw === "general" || raw === "none") {
        partnerWarehouseId = null;
      } else {
        const wid = num(raw);
        if (wid == null) {
          return fail(422, "Gudang tidak valid.", { warehouseId: ["Gudang tidak valid."] });
        }
        partnerWarehouseId = wid;
      }
      try {
        await ensurePartnerProfile(existing.id, existingSlugs, { warehouseId: partnerWarehouseId });
      } catch (e) {
        if (e instanceof Error && e.message === "WAREHOUSE_NOT_FOUND") {
          return fail(422, "Gudang tidak ditemukan / tidak aktif.", { warehouseId: ["Gudang tidak ditemukan / tidak aktif."] });
        }
        throw e;
      }
    }

    await audit({ action: "updated", entityType: "user", entityId: updated.id, entityLabel: updated.username, actor: user, after: { name: updated.name, roles: body.roleIds, warehouseId: body.warehouseId } });
    const full = await db.user.findUnique({
      where: { id: updated.id },
      include: { employee: true, roles: { include: { role: true } }, partner: { include: { warehouse: { select: { id: true, name: true } } } } },
    });
    return ok({
      ...full,
      passwordHash: undefined,
      partnerId: full?.partner?.id ?? null,
      partnerType: full?.partner?.type ?? null,
      partnerWarehouseId: full?.partner?.warehouseId ?? null,
      partnerWarehouseName: full?.partner?.warehouse?.name ?? null,
    });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
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
