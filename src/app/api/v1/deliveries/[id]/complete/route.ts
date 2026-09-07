import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Complete a delivery (handover to customer).
 * Requirement: every package must be QR-scanned "ok" first, plus a
 * proof-of-delivery note (receiver name). On success the shipment becomes
 * DELIVERED and tracking records who received the package.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "delivery.confirm");
    const { id } = await params;
    const delivery = await db.delivery.findUnique({
      where: { id: Number(id) },
      include: { master: { include: { details: true, customer: true } } },
    });
    if (!delivery) return fail(404, "Delivery tidak ditemukan.");
    if (delivery.status === "COMPLETED") return fail(422, "Delivery sudah selesai.");
    if (delivery.status === "FAILED") return fail(422, "Delivery ditandai gagal — buat task baru bila perlu.");

    const denied = assertKurirAssignment(delivery, user, "delivery.assign_kurir", delivery.deliveryCode);
    if (denied) return fail(403, denied);

    const progress = await scanProgress({ deliveryId: delivery.id });
    if (delivery.master.details.length === 0) {
      return fail(422, "Shipment belum punya detail barang.");
    }
    if (!progress.allScanned) {
      const remaining = progress.details.filter((d) => !d.scanned).map((d) => d.detailCode);
      return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}). Sisa: ${remaining.join(", ")}`);
    }

    const body = await req.json().catch(() => ({}));
    const proof = requireStr(body.proofOfDelivery, "proofOfDelivery");
    const notes = str(body.notes) ?? delivery.notes;

    const kurirName = delivery.kurirId
      ? (await db.employee.findUnique({ where: { id: delivery.kurirId } }))?.name ?? user.name
      : user.name;
    const customerName = delivery.master.customer.name;

    const updated = await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "COMPLETED", completedAt: new Date(), proofOfDelivery: proof, notes },
    });
    if (delivery.master.status !== "DELIVERED") {
      await db.masterShipment.update({ where: { id: delivery.masterId }, data: { status: "DELIVERED" } });
    }
    await db.trackingEvent.create({
      data: {
        masterId: delivery.masterId,
        event: "DELIVERED",
        description: `Delivered to ${customerName} by ${kurirName} — received by: ${proof}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "status_change",
      entityType: "delivery",
      entityId: delivery.id,
      entityLabel: `${delivery.deliveryCode} → COMPLETED`,
      actor: user,
      after: { packagesScanned: `${progress.scanned}/${progress.total}`, proof, kurir: kurirName },
    });
    return ok({ ...updated, tracking: `Delivered to ${customerName} by ${kurirName}` });
  });
}
