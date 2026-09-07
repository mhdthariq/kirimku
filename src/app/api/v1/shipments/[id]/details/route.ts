import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextDetailCode } from "@/lib/code-generator";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "shipment_detail.view");
    const { id } = await params;
    const details = await db.detailShipment.findMany({ where: { masterId: Number(id) }, orderBy: { id: "asc" } });
    return ok(details);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment_detail.create");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (!["CREATED", "READY_FOR_PICKUP"].includes(master.status)) {
      return fail(422, "Detail hanya bisa ditambah saat status CREATED atau READY_FOR_PICKUP.");
    }
    const body = await req.json().catch(() => ({}));
    const description = requireStr(body.description, "description");
    const detail = await db.detailShipment.create({
      data: {
        detailCode: await nextDetailCode(master.id, master.masterCode),
        masterId: master.id,
        description,
        quantity: Math.max(1, Math.round(num(body.quantity) ?? 1)),
        lengthCm: num(body.lengthCm),
        widthCm: num(body.widthCm),
        heightCm: num(body.heightCm),
        actualWeightKg: num(body.actualWeightKg) ?? 0,
      },
    });
    await audit({ action: "created", entityType: "shipment_detail", entityId: detail.id, entityLabel: detail.detailCode, actor: user, after: { master: master.masterCode, description } });
    return ok(detail);
  });
}
