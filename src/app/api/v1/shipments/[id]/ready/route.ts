import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";

type Params = { params: Promise<{ id: string }> };

/** Submit a CREATED shipment for pickup. */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.update");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) }, include: { details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (!canTransition(master.status, "READY_FOR_PICKUP")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa di-submit untuk pickup.`);
    }
    if (master.details.length === 0) {
      return fail(422, "Tambahkan minimal satu detail barang sebelum submit untuk pickup.");
    }

    const updated = await db.masterShipment.update({ where: { id: master.id }, data: { status: "READY_FOR_PICKUP" } });
    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "READY_FOR_PICKUP",
        description: `Shipment siap dijemput (${master.details.length} detail)`,
        actorId: user.id,
      },
    });
    await audit({ action: "status_change", entityType: "shipment", entityId: master.id, entityLabel: `${master.masterCode} → READY_FOR_PICKUP`, actor: user });
    return ok(updated);
  });
}
