import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, handle, ok, fail, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { syncReturnTaskForTransport } from "@/infrastructure/services/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req);
    if (!user.isOwner) return fail(403, "Hanya Owner yang boleh membatalkan status tiba.");
    const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return fail(422, "ID transport tidak valid.");
    const transport = await db.transport.findUnique({ where: { id: Number(id) } });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "ARRIVED") return fail(422, "Hanya transport berstatus ARRIVED yang dapat dibatalkan tiba.");
    // Legacy ACTIVITY arrivals always required departure; checkpoint bypasses may be PLANNED.
    const previousStatus = transport.statusBeforeArrival ?? (transport.departedAt || transport.trackingMode === "ACTIVITY" ? "DEPARTED" : "PLANNED");
    if (previousStatus !== "PLANNED" && previousStatus !== "DEPARTED") return fail(409, "Status sebelum tiba tidak valid.");
    const updated = await db.$transaction(async (tx) => {
      const locked = await tx.transport.updateMany({
        where: { id: transport.id, status: "ARRIVED", arrivedAt: transport.arrivedAt, updatedAt: transport.updatedAt },
        data: { status: previousStatus, arrivedAt: null, statusBeforeArrival: null },
      });
      if (!locked.count) throw new HttpError(409, "Transport berubah; muat ulang sebelum membatalkan tiba.");
      await syncReturnTaskForTransport(tx, transport.id, previousStatus);
      return tx.transport.findUnique({ where: { id: transport.id } });
    });
    await audit({ action: "undo_arrival", entityType: "transport", entityId: transport.id,
      entityLabel: `${transport.transportCode} - ${previousStatus} (batalkan tiba)`, actor: user,
      before: { status: transport.status, arrivedAt: transport.arrivedAt },
      after: { status: previousStatus, arrivedAt: null },
    });
    return ok(updated);
  });
}
