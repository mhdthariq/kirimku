import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertTransportAccess, syncReturnTaskForTransport } from "@/infrastructure/services/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.depart");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        checkpointRecords: { include: { checkpoint: true } },
        shipments: { include: { master: true } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (transport.status !== "PLANNED") return fail(422, `Transport berstatus ${transport.status}, hanya PLANNED yang bisa depart.`);
    if (transport.shipments.length === 0) return fail(422, "Transport belum memiliki shipment.");
    // Complete plan required before departure: Rute + Rencana Berangkat +
    // Rencana Tiba must all be filled ("before we can confirm").
    if (transport.routeId == null) {
      return fail(422, "Rute wajib dipilih sebelum transport berangkat - lengkapi data transport terlebih dahulu.");
    }
    if (transport.plannedDepartureAt == null || transport.plannedArrivalAt == null) {
      return fail(422, "Rencana Berangkat & Rencana Tiba wajib diisi sebelum transport berangkat - lengkapi jadwal transport terlebih dahulu.");
    }
    const firstCheckpoint = transport.route?.checkpoints[0];
    const checkedInAtFirst = firstCheckpoint && transport.checkpointRecords.some((record) => record.checkpointId === firstCheckpoint.id);
    if (transport.trackingMode !== "ACTIVITY" && (!firstCheckpoint || !checkedInAtFirst)) {
      return fail(422, "Transport hanya dapat berangkat setelah check-in di checkpoint pertama.");
    }

    const updated = await db.$transaction(async (tx) => {
      const active = await tx.transport.updateMany({
        where: { id: transport.id, status: "PLANNED", trackingMode: transport.trackingMode, driverId: transport.driverId, kenekId: transport.kenekId },
        data: { updatedAt: new Date() },
      });
      if (!active.count) throw new HttpError(409, "Transport berubah; muat ulang sebelum berangkat.");
      const result = await tx.transport.update({ where: { id: transport.id }, data: { status: "DEPARTED", departedAt: new Date() } });
      await syncReturnTaskForTransport(tx, transport.id, "DEPARTED");
      for (const s of transport.shipments) {
        if (s.master.status === "RECEIVED_AT_GUDANG") {
          await tx.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "IN_TRANSPORT" } });
        }
        await tx.trackingEvent.create({
          data: { masterId: s.shipmentId, event: "IN_TRANSPORT", description: `Transport ${transport.transportCode} berangkat (rute ${transport.route?.name ?? "-"})`, actorId: user.id },
        });
      }
      return result;
    });
    await audit({ action: "status_change", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} → DEPARTED`, actor: user });
    return ok(updated);
  });
}
