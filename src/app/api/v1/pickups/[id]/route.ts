import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";
import { scanProgress, paymentSummary } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "pickup.view");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({
      where: { id: Number(id) },
      include: { master: { include: { customer: true, details: { orderBy: { id: "asc" } } } }, scans: { include: { scannedBy: true }, orderBy: { scannedAt: "desc" } } },
    });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    const progress = await scanProgress({ pickupId: pickup.id });
    const payment = await paymentSummary(pickup.masterId);
    return ok({ ...pickup, progress, paymentSummary: payment });
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.assign_kurir");
    const { id } = await params;
    const existing = await db.pickup.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Pickup tidak ditemukan.");
    if (["COMPLETED", "CANCELLED"].includes(existing.status)) {
      return fail(422, `Pickup dengan status ${existing.status} tidak bisa diubah.`);
    }
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.kurirId !== undefined) data.kurirId = num(body.kurirId);
    if (body.notes !== undefined) data.notes = str(body.notes);
    if (body.status !== undefined && ["ASSIGNED", "IN_PROGRESS"].includes(body.status)) data.status = body.status;

    const pickup = await db.pickup.update({ where: { id: existing.id }, data });
    await audit({ action: "updated", entityType: "pickup", entityId: pickup.id, entityLabel: pickup.pickupCode, actor: user, before: diffFields(existing, pickup as unknown as Record<string, unknown>) });
    return ok(pickup);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.assign_kurir");
    const { id } = await params;
    const existing = await db.pickup.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!existing) return fail(404, "Pickup tidak ditemukan.");
    if (existing.status === "COMPLETED") return fail(422, "Pickup yang sudah selesai tidak bisa dihapus.");
    // Revision Part A — once the package is in the kurir's custody (PICKED_UP),
    // the task cannot be cancelled: it will complete when the package reaches
    // the gudang.
    if (existing.status === "PICKED_UP") {
      return fail(422, "Paket sudah diambil kurir (PICKED_UP) — pickup tidak bisa dibatalkan; tunggu paket tiba di gudang.");
    }

    await db.pickup.update({ where: { id: existing.id }, data: { status: "CANCELLED" } }).catch(() => undefined);
    if (existing.master.status === "PICKED_UP") {
      await db.masterShipment.update({ where: { id: existing.masterId }, data: { status: "READY_FOR_PICKUP" } });
    }
    await db.trackingEvent.create({
      data: { masterId: existing.masterId, event: "PICKUP_CANCELLED", description: `Pickup ${existing.pickupCode} dibatalkan`, actorId: user.id },
    });
    await audit({ action: "cancelled", entityType: "pickup", entityId: existing.id, entityLabel: existing.pickupCode, actor: user });
    return ok({ cancelled: true });
  });
}
