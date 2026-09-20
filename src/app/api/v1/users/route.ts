import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { guard, ok, handle, fail, requireStr, str, bool, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { ensurePartnerProfile } from "@/lib/partner";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "user.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const includeInactive = bool(params.get("include_inactive"), true);
    const users = await db.user.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { OR: [{ name: { contains: search } }, { username: { contains: search } }] } : {}),
      },
      orderBy: { id: "asc" },
      include: {
        employee: true,
        roles: { include: { role: true } },
        partner: { include: { warehouse: { select: { id: true, name: true } } } },
      },
    });
    return ok(users.map((u) => ({
      ...u,
      passwordHash: undefined,
      partnerId: u.partner?.id ?? null,
      partnerType: u.partner?.type ?? null,
      // Revise round 10 — include marketing partner's gudang alignment.
      partnerWarehouseId: u.partner?.warehouseId ?? null,
      partnerWarehouseName: u.partner?.warehouse?.name ?? null,
    })));
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "user.create");
    const body = await req.json().catch(() => ({}));
    const username = requireStr(body.username, "username").toLowerCase();
    const name = requireStr(body.name, "name");
    const password = requireStr(body.password, "password");
    if (password.length < 8) {
      return fail(422, "Password minimal 8 karakter.", { password: ["Password minimal 8 karakter."] });
    }
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) return fail(422, `Username ${username} sudah dipakai.`, { username: ["Username sudah dipakai."] });

    const employeeId = str(body.employeeId) ? Number(body.employeeId) : null;
    if (employeeId) {
      const employee = await db.employee.findUnique({ where: { id: employeeId } });
      if (!employee) return fail(422, "Employee tidak ditemukan.", { employeeId: ["Employee tidak ditemukan."] });
      const linked = await db.user.findUnique({ where: { employeeId } });
      if (linked) return fail(422, "Employee ini sudah memiliki akun user.", { employeeId: ["Employee sudah memiliki akun."] });
    }

    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(Number).filter(Boolean) : [];
    const selectedRoles = roleIds.length > 0 ? await db.role.findMany({ where: { id: { in: roleIds } }, select: { slug: true } }) : [];
    if (employeeId && selectedRoles.some((role) => role.slug === "marketing" || role.slug === "vehicle-owner")) {
      return fail(422, "Partner Marketing / Vehicle Owner tidak boleh terhubung ke employee.", { employeeId: ["Partner tidak boleh terhubung ke employee."] });
    }

    const created = await db.user.create({
      data: { username, name, passwordHash: hashPassword(password), employeeId, isActive: true },
    });

    const assignedSlugs: string[] = [];
    for (const roleId of roleIds) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (role) {
        await db.userRole.create({ data: { userId: created.id, roleId } }).catch(() => undefined);
        assignedSlugs.push(role.slug);
      }
    }

    // Revise.md — assigning a partner role provisions the partner profile +
    // wallet (individual profit sharing can be configured later by Owner).
    const companyPercent = num(body.companyPercent) ?? undefined;
    const partnerPercent = num(body.partnerPercent) ?? undefined;
    // Revise round 10 — marketing partner gudang alignment at creation.
    // body.warehouseId accepts: number | null | "general" | "none" | "".
    // null/general/none/"" → "umum" (no gudang alignment).
    // For VEHICLE_OWNER, the warehouseId is silently ignored (alignment is
    // marketing-only — see lib/partner.ts ensurePartnerProfile).
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
      await ensurePartnerProfile(created.id, assignedSlugs, {
        companyPercent,
        partnerPercent,
        warehouseId: partnerWarehouseId,
      });
    } catch (e) {
      if (e instanceof Error && e.message === "WAREHOUSE_NOT_FOUND") {
        return fail(422, "Gudang tidak ditemukan / tidak aktif.", { warehouseId: ["Gudang tidak ditemukan / tidak aktif."] });
      }
      throw e;
    }

    await audit({ action: "created", entityType: "user", entityId: created.id, entityLabel: created.username, actor: user, after: { username, name } });

    // When the created user is a Marketing / Vehicle Owner partner, also
    // record an audit entry with entityType="partner" so the Partners tab has
    // its own complete activity trail (creation + edits + disables).
    if (assignedSlugs.includes("marketing") || assignedSlugs.includes("vehicle-owner")) {
      const partnerProfile = await db.partner.findUnique({ where: { userId: created.id }, select: { id: true, type: true } });
      if (partnerProfile) {
        await audit({
          action: "created",
          entityType: "partner",
          entityId: partnerProfile.id,
          entityLabel: created.username,
          actor: user,
          after: { name, type: partnerProfile.type, username },
        });
      }
    }

    const full = await db.user.findUnique({
      where: { id: created.id },
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
