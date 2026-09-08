import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextDetailCodes } from "@/lib/code-generator";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "shipment_detail.view");
    const { id } = await params;
    const details = await db.detailShipment.findMany({ where: { masterId: Number(id) }, orderBy: { id: "asc" } });
    return ok(details);
  });
}

/**
 * Create detail barang. One input row with quantity N expands into N physical
 * package rows, each with its own unique detailCode (QR label). This matches
 * the "All" table structure — the grouped view is pure UI aggregation.
 */
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
    const qty = Math.round(num(body.quantity) ?? 1);
    if (!Number.isFinite(qty) || qty < 1 || qty > 500) {
      return fail(422, "Jumlah paket harus antara 1–500.", { quantity: ["Jumlah paket harus antara 1–500."] });
    }

    const codes = await nextDetailCodes(master.id, master.masterCode, qty);
    const rows = codes.map((detailCode) => ({
      detailCode,
      masterId: master.id,
      description,
      lengthCm: num(body.lengthCm),
      widthCm: num(body.widthCm),
      heightCm: num(body.heightCm),
      actualWeightKg: num(body.actualWeightKg) ?? 0,
    }));
    await db.detailShipment.createMany({ data: rows });
    const created = await db.detailShipment.findMany({
      where: { masterId: master.id, detailCode: { in: codes } },
      orderBy: { id: "asc" },
    });
    await audit({
      action: "created", entityType: "shipment_detail", entityId: created[0]?.id, entityLabel: master.masterCode,
      actor: user,
      after: { master: master.masterCode, description, packages: created.length, codes: [created[0]?.detailCode, created[created.length - 1]?.detailCode] },
    });
    return ok({ created: created.length, details: created });
  });
}
