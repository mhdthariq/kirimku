import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canApproveDelivery } from "@/lib/transport-ops";
import { assertDestinationApprover } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string; shipmentId: string }> };

/** POST /transports/:id/drops/:shipmentId/approve — destination admin accepts the dropped resi. */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.delivery.approve");
    const { id, shipmentId } = await params;
    const ts = await db.transportShipment.findUnique({
      where: { transportId_shipmentId: { transportId: Number(id), shipmentId: Number(shipmentId) } },
      include: { master: true, transport: { select: { transportCode: true } } },
    });
    if (!ts) return fail(404, "Resi tidak ada di transport ini.");
    await assertDestinationApprover(user, ts.master);
    const problem = canApproveDelivery(ts.dropStatus);
    if (problem) return fail(422, problem);

    await db.$transaction(async (tx) => {
      await tx.transportShipment.update({
        where: { transportId_shipmentId: { transportId: ts.transportId, shipmentId: ts.shipmentId } },
        data: { dropStatus: "DELIVERY_APPROVED", deliveryApprovedAt: new Date(), deliveryApprovedById: user.id },
      });
      await tx.trackingEvent.create({
        data: { masterId: ts.shipmentId, event: "DELIVERY_APPROVED", description: `Delivery disetujui oleh ${user.name} (transport ${ts.transport.transportCode})`, actorId: user.id },
      });
    });
    await audit({ action: "approve", entityType: "transport", entityId: ts.transportId, entityLabel: `${ts.transport.transportCode} · ${ts.master.masterCode} DELIVERY_APPROVED`, actor: user });
    return ok({ shipmentId: ts.shipmentId, dropStatus: "DELIVERY_APPROVED" });
  });
}
