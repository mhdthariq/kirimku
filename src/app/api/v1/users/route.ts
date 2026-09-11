import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { guard, ok, handle, fail, requireStr, str, bool, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { ensurePartnerProfile } from "@/lib/partner";

export async function GET(req: NextRequest) {
  return handle(async () => {
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
      include: { employee: true, roles: { include: { role: true } }, partner: true },
    });
    return ok(users.map((u) => ({ ...u, passwordHash: undefined, partnerId: u.partner?.id ?? null, partnerType: u.partner?.type ?? null })));
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
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

    const created = await db.user.create({
      data: { username, name, passwordHash: hashPassword(password), employeeId, isActive: true },
    });

    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(Number).filter(Boolean) : [];
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
    await ensurePartnerProfile(created.id, assignedSlugs, { companyPercent, partnerPercent });

    await audit({ action: "created", entityType: "user", entityId: created.id, entityLabel: created.username, actor: user, after: { username, name } });
    const full = await db.user.findUnique({ where: { id: created.id }, include: { employee: true, roles: { include: { role: true } }, partner: true } });
    return ok({ ...full, passwordHash: undefined, partnerId: full?.partner?.id ?? null, partnerType: full?.partner?.type ?? null });
  });
}
