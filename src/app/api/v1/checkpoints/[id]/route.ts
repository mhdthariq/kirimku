import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, requireNum } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { MIN_CHECKPOINTS } from "@/lib/shipment-flow";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.update");
    const { id } = await params;
    const existing = await db.checkpoint.findUnique({ where: { id: Number(id) }, include: { route: true } });
    if (!existing) return fail(404, "Checkpoint tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = str(body.name) ?? existing.name;
    if (body.latitude !== undefined) data.latitude = requireNum(body.latitude, "latitude", -90);
    if (body.longitude !== undefined) data.longitude = requireNum(body.longitude, "longitude", -180);
    if (body.radiusMeters !== undefined) data.radiusMeters = Math.max(10, Math.round(requireNum(body.radiusMeters, "radiusMeters", 10)));
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const checkpoint = await db.checkpoint.update({ where: { id: existing.id }, data });
    await audit({
      action: "updated", entityType: "checkpoint", entityId: checkpoint.id,
      entityLabel: `${existing.route.name} · #${checkpoint.sequence} ${checkpoint.name}`, actor: user, after: checkpoint,
    });
    return ok(checkpoint);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.delete");
    const { id } = await params;
    const existing = await db.checkpoint.findUnique({ where: { id: Number(id) }, include: { route: { include: { checkpoints: true, transports: true } } } });
    if (!existing) return fail(404, "Checkpoint tidak ditemukan.");

    if (existing.route.checkpoints.length <= MIN_CHECKPOINTS) {
      return fail(422, `Rute wajib memiliki minimal ${MIN_CHECKPOINTS} checkpoint. Tambahkan checkpoint lain sebelum menghapus yang ini.`);
    }

    await db.checkpoint.delete({ where: { id: existing.id } });
    // resequence remaining checkpoints
    const remaining = await db.checkpoint.findMany({ where: { routeId: existing.routeId }, orderBy: { sequence: "asc" } });
    for (const [i, c] of remaining.entries()) {
      if (c.sequence !== i + 1) {
        await db.checkpoint.update({ where: { id: c.id }, data: { sequence: i + 1 } });
      }
    }
    await audit({
      action: "deleted", entityType: "checkpoint", entityId: existing.id,
      entityLabel: `${existing.route.name} · #${existing.sequence} ${existing.name}`, actor: user, before: existing,
    });
    return ok({ deleted: true });
  });
}
