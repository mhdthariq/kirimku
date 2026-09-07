import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.depart");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { route: true, shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "PLANNED") return fail(422, `Transport berstatus ${transport.status}, hanya PLANNED yang bisa depart.`);
    if (transport.shipments.length === 0) return fail(422, "Transport belum memiliki shipment.");

    const updated = await db.transport.update({ where: { id: transport.id }, data: { status: "DEPARTED", departedAt: new Date() } });
    for (const s of transport.shipments) {
      if (s.master.status === "RECEIVED_AT_GUDANG") {
        await db.masterShipment.update({ where: { id: s.masterId }, data: { status: "IN_TRANSPORT" } });
      }
      await db.trackingEvent.create({
        data: { masterId: s.masterId, event: "IN_TRANSPORT", description: `Transport ${transport.transportCode} berangkat (rute ${transport.route?.name ?? "-"})`, actorId: user.id },
      });
    }
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → DEPARTED`, actor: user });
    return ok(updated);
  });
}
