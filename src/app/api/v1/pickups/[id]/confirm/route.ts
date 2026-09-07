import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm pickup completion.
 * Requirement: every detail barang (package) must have been QR-scanned "ok"
 * before the kurir can confirm. On success the shipment moves to PICKED_UP
 * and tracking shows "Picked-up by [Kurir Name]".
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.confirm");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({
      where: { id: Number(id) },
      include: { master: { include: { details: true, customer: true } } },
    });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    if (pickup.status === "COMPLETED") return fail(422, "Pickup sudah selesai.");
    if (pickup.status === "CANCELLED") return fail(422, "Pickup sudah dibatalkan.");

    const denied = assertKurirAssignment(pickup, user, "pickup.assign_kurir", pickup.pickupCode);
    if (denied) return fail(403, denied);

    const progress = await scanProgress({ pickupId: pickup.id });
    if (pickup.master.details.length === 0) {
      return fail(422, "Shipment belum punya detail barang — tambahkan detail sebelum pickup.");
    }
    if (!progress.allScanned) {
      const remaining = progress.details.filter((d) => !d.scanned).map((d) => d.detailCode);
      return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}). Sisa: ${remaining.join(", ")}`);
    }

    const body = await req.json().catch(() => ({}));
    const notes = str(body.notes) ?? pickup.notes;

    // Assigned kurir name for the tracking event — fallback to confirming user.
    const kurirName = pickup.kurirId
      ? (await db.employee.findUnique({ where: { id: pickup.kurirId } }))?.name ?? user.name
      : user.name;

    const updated = await db.pickup.update({
      where: { id: pickup.id },
      data: { status: "COMPLETED", completedAt: new Date(), notes },
    });
    if (pickup.master.status === "READY_FOR_PICKUP") {
      await db.masterShipment.update({ where: { id: pickup.masterId }, data: { status: "PICKED_UP" } });
    }
    await db.trackingEvent.create({
      data: {
        masterId: pickup.masterId,
        event: "PICKED_UP",
        description: `Picked-up by ${kurirName}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "status_change",
      entityType: "pickup",
      entityId: pickup.id,
      entityLabel: `${pickup.pickupCode} → COMPLETED`,
      actor: user,
      after: { packagesScanned: `${progress.scanned}/${progress.total}`, kurir: kurirName },
    });
    return ok({ ...updated, tracking: `Picked-up by ${kurirName}` });
  });
}
