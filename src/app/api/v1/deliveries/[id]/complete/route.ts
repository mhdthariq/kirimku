import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "delivery.confirm");
    const { id } = await params;
    const delivery = await db.delivery.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!delivery) return fail(404, "Delivery tidak ditemukan.");
    if (delivery.status === "COMPLETED") return fail(422, "Delivery sudah selesai.");

    const body = await req.json().catch(() => ({}));
    const proof = requireStr(body.proofOfDelivery, "proofOfDelivery");

    const updated = await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "COMPLETED", completedAt: new Date(), proofOfDelivery: proof, notes: body.notes ? String(body.notes) : delivery.notes },
    });

    if (delivery.master.status !== "DELIVERED") {
      await db.masterShipment.update({ where: { id: delivery.masterId }, data: { status: "DELIVERED" } });
    }
    await db.trackingEvent.create({
      data: {
        masterId: delivery.masterId,
        event: "DELIVERED",
        description: `Pengiriman selesai (${delivery.deliveryCode}) — bukti: ${proof}`,
        actorId: user.id,
      },
    });
    await audit({ action: "status_change", entityType: "delivery", entityId: delivery.id, entityLabel: `${delivery.deliveryCode} → COMPLETED`, actor: user });
    return ok(updated);
  });
}
