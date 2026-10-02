import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { canCreateReturnTask, returnEndpoints } from "@/lib/transport-ops";
import { assertTransportAccess, isReturnTransport } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /transports/:id/return-task — create the Resi Tugas Balik. Allowed only
 * once the WHOLE transport is delivery-approved (vehicle empty).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "return-task.create");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: { route: true, shipments: { include: { master: true } } },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (await isReturnTransport(transport.id)) return fail(422, "Ini sudah merupakan transport balik.");
    if (!transport.deliveryApprovedAt) return fail(422, "Transport belum disetujui (delivery approval) - kendaraan belum bisa dianggap kosong.");

    const active = await db.returnTask.count({ where: { originalTransportId: transport.id, status: { not: "CANCELLED" } } });
    const problem = canCreateReturnTask({ dropStatuses: transport.shipments.map((s) => s.dropStatus), hasActiveReturnTask: active > 0 });
    if (problem) return fail(422, problem);

    const { origin, destination } = returnEndpoints({
      origin: transport.origin ?? transport.route?.origin ?? null,
      destination: transport.destination ?? transport.route?.destination ?? null,
    });
    if (!origin || !destination) return fail(422, "Asal/tujuan transport tidak lengkap - tidak bisa membuat rute balik.");

    const returnTaskCode = await nextCode("returnTask", "RTN-2026-", "returnTaskCode");
    const task = await db.returnTask.create({
      data: {
        returnTaskCode,
        originalTransportId: transport.id,
        vehicleId: transport.vehicleId,
        driverId: transport.driverId,
        origin,
        destination,
        status: "CREATED",
        createdById: user.id,
      },
    });
    await audit({ action: "create", entityType: "return_task", entityId: task.id, entityLabel: `${task.returnTaskCode} ← ${transport.transportCode} (${origin} → ${destination})`, actor: user });
    return ok(task);
  });
}
