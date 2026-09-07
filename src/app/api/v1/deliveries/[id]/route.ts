import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "delivery.assign_kurir");
    const { id } = await params;
    const existing = await db.delivery.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Delivery tidak ditemukan.");
    if (["COMPLETED", "FAILED"].includes(existing.status)) {
      return fail(422, `Delivery dengan status ${existing.status} tidak bisa diubah.`);
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.kurirId !== undefined) data.kurirId = num(body.kurirId);
    if (body.notes !== undefined) data.notes = str(body.notes);
    const delivery = await db.delivery.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "delivery", entityId: delivery.id, entityLabel: delivery.deliveryCode, actor: user, before: diffFields(existing, delivery as unknown as Record<string, unknown>) });
    return ok(delivery);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "delivery.assign_kurir");
    const { id } = await params;
    const existing = await db.delivery.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Delivery tidak ditemukan.");
    if (existing.status === "COMPLETED") return fail(422, "Delivery yang sudah selesai tidak bisa dihapus.");
    await db.delivery.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "delivery", entityId: existing.id, entityLabel: existing.deliveryCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
