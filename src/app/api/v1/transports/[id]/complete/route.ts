import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertTransportAccess } from "@/infrastructure/services/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.complete");
    const { id } = await params;
    const transportId = Number(id);
    if (!Number.isSafeInteger(transportId) || transportId <= 0) return fail(422, "ID transport tidak valid.");
    const transport = await db.transport.findUnique({
      where: { id: transportId },
      include: { route: true, shipments: { include: { master: true } } },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (transport.status !== "ARRIVED") return fail(409, "Hanya transport ARRIVED yang dapat diaudit dan dikonfirmasi Completed.");

    const completion = {
      status: "COMPLETED",
      completedAt: new Date(),
      completedById: user.id,
      completedByUsername: user.username,
      completedByRole: user.isOwner ? "Owner" : user.roles.map((role) => role.name).sort().join(", "),
    };
    const result = await db.transport.updateMany({
      where: { id: transport.id, status: "ARRIVED", completedAt: null },
      data: completion,
    });
    if (result.count !== 1) return fail(409, "Status transport telah berubah. Muat ulang sebelum mengonfirmasi audit.");
    await audit({
      action: "complete", entityType: "transport", entityId: transport.id,
      entityLabel: `${transport.transportCode} → COMPLETED`, actor: user,
      before: { status: "ARRIVED" }, after: completion,
    });
    return ok({ id: transport.id, ...completion });
  });
}
