import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, requireNum, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "payment.view");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    const payments = await db.payment.findMany({
      where: { masterId: Number(id) },
      orderBy: { createdAt: "desc" },
      include: { recordedBy: true, verifiedBy: true },
    });
    return ok(payments);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "payment.record");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!master.priceAmount) return fail(422, "Hitung harga shipment terlebih dahulu sebelum mencatat pembayaran.");

    const body = await req.json().catch(() => ({}));
    const method = body.method === "TRANSFER" ? "TRANSFER" : "CASH";
    const amount = requireNum(body.amount, "amount", 1);
    const reference = str(body.reference);

    const payment = await db.payment.create({
      data: { masterId: master.id, method, amount, status: "RECORDED", reference, recordedById: user.id },
    });
    await audit({ action: "created", entityType: "payment", entityId: payment.id, entityLabel: `${master.masterCode} · Rp${amount.toLocaleString("id-ID")}`, actor: user, after: payment });
    return ok(payment);
  });
}
