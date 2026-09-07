import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.depart");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: { route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } }, shipments: { include: { master: true } } },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "PLANNED") return fail(422, `Transport berstatus ${transport.status}, hanya PLANNED yang bisa depart.`);
    if (transport.shipments.length === 0) return fail(422, "Transport belum memiliki shipment.");

    const updated = await db.transport.update({ where: { id: transport.id }, data: { status: "DEPARTED", departedAt: new Date() } });

    // Departing means the vehicle has left the route's origin checkpoint —
    // record it so position tracking starts from a known point.
    const originCp = transport.route?.checkpoints[0];
    if (originCp) {
      await db.checkpointRecord.create({
        data: {
          transportId: transport.id,
          checkpointId: originCp.id,
          latitude: originCp.latitude,
          longitude: originCp.longitude,
          withinRadius: true,
          recordedById: user.id,
        },
      });
    }

    for (const s of transport.shipments) {
      if (s.master.status === "RECEIVED_AT_GUDANG") {
        await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "IN_TRANSPORT" } });
      }
      await db.trackingEvent.create({
        data: { masterId: s.shipmentId, event: "IN_TRANSPORT", description: `Transport ${transport.transportCode} berangkat (rute ${transport.route?.name ?? "-"})`, actorId: user.id },
      });
    }
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → DEPARTED`, actor: user });
    return ok(updated);
  });
}
