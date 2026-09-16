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
    // gudang names for the tracking description ("dari Gudang A ke Gudang B")
    const warehouses = await db.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true, city: true } });
    const whName = (id: number | null | undefined) => (id == null ? null : warehouses.find((w) => w.id === id)?.name ?? null);
    const whNameByCity = (city: string | null | undefined) => {
      const key = (city ?? "").trim().toLowerCase();
      return key ? warehouses.find((w) => (w.city ?? "").trim().toLowerCase() === key)?.name ?? null : null;
    };
    const originGudangName = whName(transport.shipments[0]?.master.originWarehouseId) ?? whNameByCity(transport.origin) ?? whNameByCity(transport.route?.origin);
    const destGudangName = whName(transport.shipments[0]?.master.destinationWarehouseId) ?? whNameByCity(transport.destination) ?? whNameByCity(transport.route?.destination);

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.transport.update({ where: { id: transport.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
      for (const s of transport.shipments) {
        const destIds = shipmentDestinationGudangIds(s.master, cityIdx);
        const arrivedWarehouseId = s.master.destinationWarehouseId ?? destIds[0] ?? null;
        if (s.master.status === "IN_TRANSPORT") {
          // The transport reached the destination gudang (admin override of the
          // final-checkpoint check-in). "Arrived at {Gudang}" only happens
          // AFTER Admin Gudang of that gudang scans every package in — until
          // then the shipment sits at AT_DEST_GUDANG with destReceivedAt null.
          await tx.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "AT_DEST_GUDANG", arrivedWarehouseId, destReceivedAt: null } });
        }
        const fromTo = `${originGudangName ? ` dari ${originGudangName}` : ""}${destGudangName ? ` ke ${destGudangName}` : ""}`;
        await tx.trackingEvent.create({
          data: {
            masterId: s.shipmentId,
            event: "AT_DEST_GUDANG",
            description: `Transport ${transport.transportCode} tiba di gudang tujuan${fromTo} — paket menunggu scan penerimaan Admin Gudang sebelum berstatus Arrived`,
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
