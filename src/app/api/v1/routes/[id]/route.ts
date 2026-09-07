import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "checkpoint.view");
    const { id } = await params;
    const route = await db.route.findUnique({
      where: { id: Number(id) },
      include: {
        checkpoints: { orderBy: { sequence: "asc" } },
        transports: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!route) return fail(404, "Rute tidak ditemukan.");
    return ok(route);
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.update");
    const { id } = await params;
    const existing = await db.route.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Rute tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
    if (body.origin !== undefined) data.origin = str(body.origin);
    if (body.destination !== undefined) data.destination = str(body.destination);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const route = await db.route.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "route", entityId: route.id, entityLabel: route.name, actor: user, before: diffFields(existing, route as unknown as Record<string, unknown>) });
    return ok(route);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.delete");
    const { id } = await params;
    const existing = await db.route.findUnique({ where: { id: Number(id) }, include: { checkpoints: true, transports: true } });
    if (!existing) return fail(404, "Rute tidak ditemukan.");
    if (existing.transports.length > 0) {
      const route = await db.route.update({ where: { id: existing.id }, data: { isActive: false } });
      await audit({ action: "deactivated", entityType: "route", entityId: route.id, entityLabel: route.name, actor: user });
      return ok({ deactivated: true, route });
    }
    await db.route.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "route", entityId: existing.id, entityLabel: existing.name, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
