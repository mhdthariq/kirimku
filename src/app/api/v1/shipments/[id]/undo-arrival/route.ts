import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { db } from "@/infrastructure/persistence/db";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { HttpError } from "@/shared/http-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.undo_arrival");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Shipment tidak valid.");
    const body = (await req.json().catch(() => ({}))) ?? {};
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 1000) return fail(422, "Alasan wajib diisi (maksimal 1000 karakter).");
    const updated = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MasterShipment" WHERE id = ${id} FOR UPDATE`;
      const shipment = await tx.masterShipment.findUnique({ where: { id }, include: { deliveries: true, transportItems: true, expenses: true, trackingEvents: { orderBy: { occurredAt: "desc" } }, pickups: { orderBy: { createdAt: "desc" }, select: { id: true, status: true } } } });
      if (!shipment) throw new HttpError(404, "Shipment tidak ditemukan.");
      await assertShipmentScope(user, shipment);
      const destination = shipment.status === "ARRIVED_AT_GUDANG" && shipment.destReceivedAt != null;
      const priorOriginEvent = shipment.trackingEvents?.find(event => ["PICKED_UP", "READY_FOR_PICKUP", "CREATED"].includes(event.event))?.event;
      const previousOriginStatus = shipment.arrivalPreviousStatus ?? priorOriginEvent ?? (shipment.pickups?.some(pickup => pickup.status === "COMPLETED") ? "PICKED_UP" : "CREATED");
      const origin = shipment.status === "RECEIVED_AT_GUDANG" && ["CREATED", "READY_FOR_PICKUP", "PICKED_UP"].includes(previousOriginStatus);
      if (!destination && !origin) throw new HttpError(409, "Penerimaan gudang ini tidak dapat di-undo.");
      if (shipment.deliveries.some(delivery => delivery.status !== "CANCELLED") || (origin && shipment.transportItems.length > 0)) throw new HttpError(409, "Shipment sudah memiliki proses lanjutan. Batalkan proses tersebut terlebih dahulu.");
      if (shipment.expenses.some(expense => expense.status !== "CANCELLED")) throw new HttpError(409, "Batalkan atau hapus biaya shipment terlebih dahulu sebelum undo penerimaan.");
      const status = destination ? "AT_DEST_GUDANG" : previousOriginStatus;
      const result = await tx.masterShipment.updateMany({ where: { id, status: shipment.status, destReceivedAt: shipment.destReceivedAt }, data: { status, destReceivedAt: null, arrivalPreviousStatus: null, ...(origin ? { arrivedWarehouseId: null } : {}) } });
      if (result.count !== 1) throw new HttpError(409, "Status shipment berubah. Muat ulang data.");
      await tx.handoverScan.deleteMany({ where: { masterId: id, context: destination ? "transport_arrival" : "gudang_arrival" } });
      if (origin && status === "PICKED_UP") await tx.pickup.updateMany({ where: { masterId: id, status: "COMPLETED" }, data: { status: "PICKED_UP", completedAt: null } });
      await tx.trackingEvent.create({ data: { masterId: id, event: "ARRIVAL_UNDONE", description: `Penerimaan gudang dibatalkan → ${status}: ${reason}`, actorId: user.id } });
      await tx.auditLog.create({ data: { action: "undo_arrival", entityType: "shipment", entityId: id, entityLabel: shipment.masterCode, actorId: user.id, beforeData: JSON.stringify({ status: shipment.status, destReceivedAt: shipment.destReceivedAt }), afterData: JSON.stringify({ status, reason }) } });
      return { status };
    });
    return ok(updated);
  });
}
