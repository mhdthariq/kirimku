import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.confirm");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    if (pickup.status === "COMPLETED") return fail(422, "Pickup sudah selesai.");

    const body = await req.json().catch(() => ({}));
    const notes = str(body.notes) ?? pickup.notes;

    const updated = await db.pickup.update({
      where: { id: pickup.id },
      data: { status: "COMPLETED", completedAt: new Date(), notes },
    });
    if (pickup.master.status === "READY_FOR_PICKUP") {
      await db.masterShipment.update({ where: { id: pickup.masterId }, data: { status: "PICKED_UP" } });
    }
    await db.trackingEvent.create({
      data: { masterId: pickup.masterId, event: "PICKED_UP", description: `Pickup ${pickup.pickupCode} selesai (handover terkonfirmasi)`, actorId: user.id },
    });
    await audit({ action: "status_change", entityType: "pickup", entityId: pickup.id, entityLabel: `${pickup.pickupCode} → COMPLETED`, actor: user });
    return ok(updated);
  });
}
