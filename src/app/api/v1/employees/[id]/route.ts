import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "employee.update");
    const { id } = await params;
    const existing = await db.employee.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Employee tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
    if (body.phone !== undefined) data.phone = str(body.phone);
    if (body.position !== undefined) data.position = str(body.position);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const employee = await db.employee.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "employee", entityId: employee.id, entityLabel: employee.name, actor: user, before: diffFields(existing, employee as unknown as Record<string, unknown>) });
    return ok(employee);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "employee.disable");
    const { id } = await params;
    const existing = await db.employee.findUnique({ where: { id: Number(id) }, include: { user: true } });
    if (!existing) return fail(404, "Employee tidak ditemukan.");
    const employee = await db.employee.update({ where: { id: existing.id }, data: { isActive: false } });
    if (existing.user) {
      await db.user.update({ where: { id: existing.user.id }, data: { isActive: false } });
    }
    await audit({ action: "disabled", entityType: "employee", entityId: employee.id, entityLabel: employee.name, actor: user });
    return ok({ disabled: true, employee });
  });
}
