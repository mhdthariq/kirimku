import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { dropProgress, effectiveDropCheckpointId, groupByDropCheckpoint, isVehicleEmpty, normalizeTransportMode } from "@/lib/transport-ops";
import { assertTransportAccess } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

/** GET /transports/:id/drops — the multi drop board: checkpoints, resi per drop point, progress. */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { where: { isActive: true }, orderBy: { sequence: "asc" } } } },
        checkpointRecords: { select: { checkpointId: true } },
        shipments: { include: { master: { include: { customer: { select: { name: true, companyName: true } } } } } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);

    const checkpoints = transport.route?.checkpoints ?? [];
    const finalId = checkpoints.length ? checkpoints[checkpoints.length - 1].id : null;
    const checkedIn = new Set(transport.checkpointRecords.map((r) => r.checkpointId));
    const items = transport.shipments.map((s) => ({
      shipmentId: s.shipmentId,
      masterCode: s.master.masterCode,
      customerName: s.master.customer.companyName || s.master.customer.name,
      destination: s.master.destination,
      penerimaName: s.master.penerimaName ?? null,
      dropCheckpointId: s.dropCheckpointId,
      effectiveDropCheckpointId: effectiveDropCheckpointId(s.dropCheckpointId, finalId),
      dropStatus: s.dropStatus,
      droppedAt: s.droppedAt,
      deliveryApprovedAt: s.deliveryApprovedAt,
    }));
    const statuses = items.map((i) => i.dropStatus);
    return ok({
      transportMode: normalizeTransportMode(transport.transportMode),
      transportStatus: transport.status,
      deliveryApprovedAt: transport.deliveryApprovedAt,
      checkpoints: checkpoints.map((c) => ({ id: c.id, name: c.name, sequence: c.sequence, checkedIn: checkedIn.has(c.id), isFinal: c.id === finalId })),
      shipments: items,
      groups: groupByDropCheckpoint(items, checkpoints).map((g) => ({ checkpointId: g.checkpointId, shipmentIds: g.shipments.map((s) => s.shipmentId) })),
      progress: dropProgress(statuses),
      vehicleEmpty: isVehicleEmpty(statuses),
    });
  });
}
