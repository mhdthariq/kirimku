import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment_detail.update");
    const { id } = await params;
    const existing = await db.detailShipment.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!existing) return fail(404, "Detail shipment tidak ditemukan.");
    if (!["CREATED", "READY_FOR_PICKUP"].includes(existing.master.status)) {
      return fail(422, "Detail hanya bisa diubah saat master masih CREATED atau READY_FOR_PICKUP.");
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.description !== undefined) data.description = requireStr(body.description, "description");
    if (body.lengthCm !== undefined) data.lengthCm = num(body.lengthCm);
    if (body.widthCm !== undefined) data.widthCm = num(body.widthCm);
    if (body.heightCm !== undefined) data.heightCm = num(body.heightCm);
    if (body.actualWeightKg !== undefined) data.actualWeightKg = num(body.actualWeightKg) ?? 0;
    const detail = await db.detailShipment.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "shipment_detail", entityId: detail.id, entityLabel: detail.detailCode, actor: user, before: existing, after: detail });
    return ok(detail);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment_detail.delete");
    const { id } = await params;
    const existing = await db.detailShipment.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!existing) return fail(404, "Detail shipment tidak ditemukan.");
    if (!["CREATED", "READY_FOR_PICKUP"].includes(existing.master.status)) {
      return fail(422, "Detail hanya bisa dihapus saat master masih CREATED atau READY_FOR_PICKUP.");
    }
    await db.detailShipment.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "shipment_detail", entityId: existing.id, entityLabel: existing.detailCode, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
