import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { cityIndex, shipmentDestinationGudangIds } from "@/lib/gudang-scope";
import { canAssignDrop, canDrop, effectiveDropCheckpointId, normalizeTransportMode } from "@/lib/transport-ops";
import { assertTransportAccess, isAssignedCrew } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string; shipmentId: string }> };

/**
 * POST /transports/:id/drops/:shipmentId
 *   { action: "ASSIGN", dropCheckpointId }  plan: where this resi is unloaded
 *   { action: "DROP" }                      unload it (vehicle must have checked in at the drop checkpoint)
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view");
    const { id, shipmentId } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { where: { isActive: true }, orderBy: { sequence: "asc" } } } },
        checkpointRecords: { select: { checkpointId: true } },
        shipments: { include: { master: true } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    const ts = transport.shipments.find((s) => s.shipmentId === Number(shipmentId));
    if (!ts) return fail(404, "Resi tidak ada di transport ini.");

    const mode = normalizeTransportMode(transport.transportMode);
    const checkpoints = transport.route?.checkpoints ?? [];
    const body = await req.json().catch(() => ({}));
    const action = body.action === "DROP" ? "DROP" : body.action === "ASSIGN" ? "ASSIGN" : null;
    if (!action) return fail(422, 'action harus "ASSIGN" atau "DROP".');

    if (action === "ASSIGN") {
      if (!hasPermission(user, "transport.create")) return fail(403, "Missing permission: transport.create");
      const problem = canAssignDrop(mode, transport.status, ts.dropStatus);
      if (problem) return fail(422, problem);
      const cpId = num(body.dropCheckpointId);
      const cp = checkpoints.find((c) => c.id === cpId);
      if (!cp) return fail(422, "Checkpoint drop tidak ditemukan pada rute transport ini.", { dropCheckpointId: ["Pilih checkpoint dari rute."] });
      if (cp.sequence === checkpoints[0].sequence) return fail(422, "Checkpoint pertama adalah titik berangkat - pilih checkpoint setelahnya.", { dropCheckpointId: ["Bukan titik berangkat."] });
      await db.transportShipment.update({
        where: { transportId_shipmentId: { transportId: transport.id, shipmentId: ts.shipmentId } },
        data: { dropCheckpointId: cp.id },
      });
      await audit({ action: "update", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} · ${ts.master.masterCode} drop di ${cp.name}`, actor: user });
      return ok({ shipmentId: ts.shipmentId, dropCheckpointId: cp.id, dropStatus: ts.dropStatus });
    }

    // ---- DROP: the crew riding the vehicle (or an admin with transport.arrive) ----
    if (!(isAssignedCrew(user, transport) || hasPermission(user, "transport.arrive"))) {
      return fail(403, "Hanya driver/kenek yang ditugaskan (atau admin) yang boleh menurunkan resi.");
    }
    const finalId = checkpoints.length ? checkpoints[checkpoints.length - 1].id : null;
    const dropCpId = effectiveDropCheckpointId(ts.dropCheckpointId, finalId);
    const dropCp = checkpoints.find((c) => c.id === dropCpId);
    if (!dropCp) return fail(422, "Titik drop resi belum ditentukan.");
    const problem = canDrop({
      mode,
      transportStatus: transport.status,
      dropStatus: ts.dropStatus,
      vehicleCheckedInAtDrop: transport.checkpointRecords.some((r) => r.checkpointId === dropCp.id),
    });
    if (problem) return fail(422, problem);

    const master = ts.master;
    const cityIdx = await cityIndex();
    const arrivedWarehouseId = master.destinationWarehouseId ?? shipmentDestinationGudangIds(master, cityIdx)[0] ?? null;
    const isDirectFulfillment = (master.fulfillmentMode ?? "STANDARD") === "DIRECT";

    await db.$transaction(async (tx) => {
      await tx.transportShipment.update({
        where: { transportId_shipmentId: { transportId: transport.id, shipmentId: ts.shipmentId } },
        data: { dropStatus: "DROPPED", droppedAt: new Date(), droppedById: user.id },
      });
      // Same effect as reaching the destination, but for THIS resi only.
      if (master.status === "IN_TRANSPORT") {
        if (isDirectFulfillment) {
          await tx.masterShipment.update({ where: { id: master.id }, data: { status: "ARRIVED_AT_GUDANG", arrivedWarehouseId, destReceivedAt: new Date() } });
          const existing = await tx.delivery.findFirst({ where: { masterId: master.id }, select: { id: true } });
          if (!existing && transport.driverId != null) {
            const deliveryCode = await nextCode("delivery", "DLV-2026-", "deliveryCode");
            await tx.delivery.create({
              data: { deliveryCode, masterId: master.id, kurirId: transport.driverId, status: "ASSIGNED", notes: `Auto-assigned dari transport ${transport.transportCode} (multi drop di ${dropCp.name})` },
            });
          }
        } else {
          await tx.masterShipment.update({ where: { id: master.id }, data: { status: "AT_DEST_GUDANG", arrivedWarehouseId, destReceivedAt: null } });
        }
      }
      await tx.trackingEvent.create({
        data: {
          masterId: master.id,
          event: isDirectFulfillment ? "ARRIVED_AT_GUDANG" : "AT_DEST_GUDANG",
          description: `Resi diturunkan di checkpoint ${dropCp.name} (transport ${transport.transportCode}) oleh ${user.name} - menunggu persetujuan delivery`,
          actorId: user.id,
        },
      });
    });
    await audit({ action: "drop", entityType: "transport", entityId: transport.id, entityLabel: `${transport.transportCode} · ${master.masterCode} diturunkan di ${dropCp.name}`, actor: user });
    return ok({ shipmentId: ts.shipmentId, dropStatus: "DROPPED", checkpointName: dropCp.name });
  });
}
