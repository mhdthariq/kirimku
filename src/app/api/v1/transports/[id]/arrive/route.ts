import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { shipmentDestinationGudangIds, cityIndex } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.arrive");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { route: true, shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "DEPARTED") return fail(422, `Transport berstatus ${transport.status}, hanya DEPARTED yang bisa arrive.`);

    const updated = await db.transport.update({ where: { id: transport.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
    // Record the destination gudang on each shipment so gudang data
    // separation stays accurate (the package now physically sits there).
    const cityIdx = await cityIndex();
    for (const s of transport.shipments) {
      const destIds = shipmentDestinationGudangIds(s.master, cityIdx);
      const arrivedWarehouseId = s.master.destinationWarehouseId ?? destIds[0] ?? null;
      if (s.master.status === "IN_TRANSPORT") {
        await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "ARRIVED_AT_GUDANG", arrivedWarehouseId } });
      }
      await db.trackingEvent.create({
        data: {
          masterId: s.shipmentId, event: "ARRIVED_AT_GUDANG",
          description: `Transport ${transport.transportCode} tiba di gudang tujuan`,
          actorId: user.id,
        },
      });
    }
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → ARRIVED`, actor: user });
    return ok(updated);
  });
}
