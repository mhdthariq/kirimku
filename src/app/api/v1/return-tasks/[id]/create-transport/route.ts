import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, dateOrNull } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { buildReturnCheckpoints, canCreateReturnTransport } from "@/lib/transport-ops";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /return-tasks/:id/create-transport — { plannedDepartureAt?, plannedArrivalAt? }
 * Builds the return Transport: a new Route with the outbound checkpoints in
 * reverse order, same vehicle and driver, no resi (empty run), status PLANNED.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "return-task.create");
    const { id } = await params;
    const task = await db.returnTask.findUnique({
      where: { id: Number(id) },
      include: { originalTransport: { include: { route: { include: { checkpoints: { where: { isActive: true }, orderBy: { sequence: "asc" } } } } } } },
    });
    if (!task) return fail(404, "Resi tugas balik tidak ditemukan.");
    const problem = canCreateReturnTransport(task.status, task.returnTransportId != null);
    if (problem) return fail(422, problem);

    const outbound = task.originalTransport.route?.checkpoints ?? [];
    if (outbound.length < 3) return fail(422, "Rute asal punya kurang dari 3 checkpoint - rute balik tidak bisa dibuat.");
    const body = await req.json().catch(() => ({}));
    const plannedDepartureAt = dateOrNull(body.plannedDepartureAt) ?? new Date();
    const plannedArrivalAt = dateOrNull(body.plannedArrivalAt) ?? new Date(plannedDepartureAt.getTime() + 6 * 3600 * 1000);
    if (plannedArrivalAt < plannedDepartureAt) return fail(422, "Rencana tiba tidak boleh lebih awal dari rencana berangkat.");

    const transportCode = await nextCode("transport", "TRP-2026-", "transportCode");
    const result = await db.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: { name: `${task.originalTransport.route?.name ?? "Rute"} (Balik)`, origin: task.origin, destination: task.destination, isActive: true },
      });
      for (const c of buildReturnCheckpoints(outbound)) {
        await tx.checkpoint.create({
          data: { routeId: route.id, name: c.name, sequence: c.sequence, latitude: c.latitude, longitude: c.longitude, radiusMeters: c.radiusMeters, isActive: true },
        });
      }
      const transport = await tx.transport.create({
        data: {
          transportCode,
          routeId: route.id,
          vehicleId: task.vehicleId,
          driverId: task.driverId,
          kenekId: task.originalTransport.kenekId,
          origin: task.origin,
          destination: task.destination,
          plannedDepartureAt,
          plannedArrivalAt,
          status: "PLANNED",
          transportMode: "DIRECT",
        },
      });
      const updated = await tx.returnTask.update({ where: { id: task.id }, data: { returnTransportId: transport.id, status: "PLANNED" } });
      return { transport, task: updated };
    });
    await audit({ action: "create", entityType: "transport", entityId: result.transport.id, entityLabel: `${result.transport.transportCode} (balik) ← ${task.returnTaskCode}`, actor: user });
    return ok({ returnTask: result.task, transport: { id: result.transport.id, transportCode: result.transport.transportCode, status: result.transport.status } });
  });
}
