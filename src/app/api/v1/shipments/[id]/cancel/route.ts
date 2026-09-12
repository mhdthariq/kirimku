import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.cancel");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!canTransition(master.status, "CANCELLED")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa dibatalkan.`);
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.masterShipment.update({ where: { id: master.id }, data: { status: "CANCELLED" } });
      await tx.trackingEvent.create({
        data: { masterId: master.id, event: "CANCELLED", description: `Shipment dibatalkan oleh ${user.name}`, actorId: user.id },
      });
      return result;
    });
    await audit({ action: "status_change", entityType: "shipment", entityId: master.id, entityLabel: `${master.masterCode} → CANCELLED`, actor: user });
    return ok(updated);
  });
}
