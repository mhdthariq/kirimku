import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.arrive");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { route: true, shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "DEPARTED") return fail(422, `Transport berstatus ${transport.status}, hanya DEPARTED yang bisa arrive.`);

    const updated = await db.transport.update({ where: { id: transport.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
    for (const s of transport.shipments) {
      if (s.master.status === "IN_TRANSPORT") {
        await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "ARRIVED_AT_GUDANG" } });
      }
      await db.trackingEvent.create({
        data: { masterId: s.shipmentId, event: "ARRIVED_AT_GUDANG", description: `Transport ${transport.transportCode} tiba di gudang tujuan`, actorId: user.id },
      });
    }
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → ARRIVED`, actor: user });
    return ok(updated);
  });
}
