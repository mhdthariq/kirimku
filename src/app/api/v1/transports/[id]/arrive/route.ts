import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { shipmentDestinationGudangIds, cityIndex } from "@/infrastructure/services/gudang-scope";
import { nextCode } from "@/infrastructure/services/code-generator";
import { assertTransportAccess, syncReturnTaskForTransport } from "@/infrastructure/services/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.arrive");
    const { id } = await params;
    const transport = await db.transport.findUnique({ where: { id: Number(id) }, include: { route: true, shipments: { include: { master: true } } } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (transport.trackingMode === "ACTIVITY" && transport.status !== "DEPARTED") return fail(422, "Transport ACTIVITY harus berangkat sebelum diselesaikan.");
    if (transport.status !== "PLANNED" && transport.status !== "DEPARTED") {
      return fail(422, `Transport berstatus ${transport.status}, hanya PLANNED atau DEPARTED yang bisa diselesaikan.`);
    }
    const bypassedStart = transport.status === "PLANNED";

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
      const active = await tx.transport.updateMany({
        where: { id: transport.id, status: transport.status, trackingMode: transport.trackingMode, driverId: transport.driverId, kenekId: transport.kenekId },
        data: { updatedAt: new Date() },
      });
      if (!active.count) throw new HttpError(409, "Transport berubah; muat ulang sebelum menyelesaikan.");
      const result = await tx.transport.update({ where: { id: transport.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
      for (const s of transport.shipments) {
        // Multi drop: resi already unloaded at an earlier checkpoint were handled by the drop step.
        if (s.dropStatus !== "LOADED" && s.dropStatus !== "AT_DROP_POINT") continue;
        const destIds = shipmentDestinationGudangIds(s.master, cityIdx);
        const arrivedWarehouseId = s.master.destinationWarehouseId ?? destIds[0] ?? null;
        if (
          transport.trackingMode === "ACTIVITY" &&
          (s.master.fulfillmentMode ?? "STANDARD") === "DIRECT"
        ) {
          await tx.masterShipment.update({
            where: { id: s.shipmentId },
            data: {
              status: "ARRIVED_AT_GUDANG",
              arrivedWarehouseId,
              destReceivedAt: new Date(),
            },
          });
          const delivery = await tx.delivery.findFirst({
            where: { masterId: s.shipmentId },
            select: { id: true },
          });
          if (!delivery && transport.driverId != null) {
            await tx.delivery.create({
              data: {
                deliveryCode: await nextCode(
                  "delivery",
                  "DLV-2026-",
                  "deliveryCode",
                ),
                masterId: s.shipmentId,
                kurirId: transport.driverId,
                status: "ASSIGNED",
                notes: `Auto-assigned dari transport ${transport.transportCode} (ACTIVITY - DIRECT)`,
              },
            });
          }
          await tx.trackingEvent.create({
            data: {
              masterId: s.shipmentId,
              event: "ARRIVED_AT_GUDANG",
              description: `Transport ${transport.transportCode} tiba di tujuan`,
              actorId: user.id,
            },
          });
          continue;
        }
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
            description: `Transport ${transport.transportCode} tiba di gudang tujuan${fromTo} - paket menunggu scan penerimaan Admin Gudang sebelum berstatus Arrived`,
            actorId: user.id,
          },
        });
      }
      // Whatever is still on board reached the destination: it counts as dropped now,
      // so delivery approval (and then the return task) can follow.
      await tx.transportShipment.updateMany({
        where: { transportId: transport.id, dropStatus: { in: ["LOADED", "AT_DROP_POINT"] } },
        data: { dropStatus: "DROPPED", droppedAt: new Date(), droppedById: user.id },
      });
      await syncReturnTaskForTransport(tx, transport.id, "ARRIVED");
      return result;
    });
    await audit({ action: bypassedStart ? "status_change_bypass" : "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → ARRIVED${bypassedStart ? " (bypass belum berangkat)" : ""}`, actor: user });
    return ok(updated);
  });
}
