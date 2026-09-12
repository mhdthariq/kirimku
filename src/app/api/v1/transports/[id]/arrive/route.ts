import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { shipmentDestinationGudangIds, cityIndex } from "@/lib/gudang-scope";
import { assertTransportScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.arrive");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { route: true, shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportScope(user, transport.route ?? { origin: null, destination: null }, transport.shipments.map((s) => s.master));
    if (transport.status !== "DEPARTED") return fail(422, `Transport berstatus ${transport.status}, hanya DEPARTED yang bisa arrive.`);

    const cityIdx = await cityIndex();
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.transport.update({ where: { id: transport.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
      for (const s of transport.shipments) {
        const destIds = shipmentDestinationGudangIds(s.master, cityIdx);
        const arrivedWarehouseId = s.master.destinationWarehouseId ?? destIds[0] ?? null;
        if (s.master.status === "IN_TRANSPORT") {
          await tx.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "ARRIVED_AT_GUDANG", arrivedWarehouseId } });
        }
        await tx.trackingEvent.create({
          data: {
            masterId: s.shipmentId, event: "ARRIVED_AT_GUDANG",
            description: `Transport ${transport.transportCode} tiba di gudang tujuan`,
            actorId: user.id,
          },
        });
      }
      return result;
    });
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → ARRIVED`, actor: user });
    return ok(updated);
  });
}
