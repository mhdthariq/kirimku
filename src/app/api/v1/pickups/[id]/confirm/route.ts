import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm that the kurir has PICKED UP the package from the customer.
 * Requirements:
 * - every detail barang (package) must have been QR-scanned "ok" before the
 *   kurir can confirm;
 * - B2B shipments MUST be linked to an invoice before pickup — penagihan B2B
 *   dilakukan via invoice, jadi pickup tidak boleh terjadi sebelum shipment
 *   masuk ke invoice perusahaan tersebut.
 * - DP rule dihapus: untuk B2C semua biaya ditanggung Marketing (jadi tidak
 *   ada pemeriksaan pembayaran di sini). Untuk B2B pembayaran ditagihkan via
 *   invoice terpisah.
 *
 * Pickup lifecycle (Revision Part A):
 *   ASSIGNED → PICKED_UP (this action) → … in transit … → the package arrives
 *   at the gudang and Admin Gudang confirms arrival (scan / walk-in) → the
 *   pickup is then marked COMPLETED by that arrival workflow.
 * The kurir must NOT be able to complete the pickup here — the task stays
 * PICKED_UP while the package is in the kurir's custody.
 * On success the shipment moves to PICKED_UP and tracking shows
 * "Picked-up by [Kurir Name]".
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.confirm");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({
      where: { id: Number(id) },
      include: { master: { include: { details: true, customer: true, invoiceLines: true } } },
    });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    if (pickup.status === "COMPLETED") return fail(422, "Pickup sudah selesai.");
    if (pickup.status === "CANCELLED") return fail(422, "Pickup sudah dibatalkan.");
    if (pickup.status === "PICKED_UP") return fail(422, "Paket sudah diambil kurir (Picked Up) — pickup akan selesai otomatis saat paket tiba di gudang.");

    const denied = assertKurirAssignment(pickup, user, "pickup.assign_kurir", pickup.pickupCode);
    if (denied) return fail(403, denied);

    const progress = await scanProgress({ pickupId: pickup.id });
    if (pickup.master.details.length === 0) {
      return fail(422, "Shipment belum punya detail barang — tambahkan detail sebelum pickup.");
    }
    if (!progress.allScanned) {
      const remaining = progress.total - progress.scanned;
      return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}, sisa ${remaining} paket).`);
    }

    // --- B2B invoice gate: shipment B2B wajib ada di salah satu invoice -----
    // perusahaan customer-nya sebelum bisa di-pickup. Untuk B2C biaya
    // ditanggung Marketing, jadi tidak ada pemeriksaan pembayaran.
    if (pickup.master.customer?.type === "b2b") {
      const hasInvoice = pickup.master.invoiceLines.length > 0;
      if (!hasInvoice) {
        return fail(
          422,
          "Shipment B2B belum ditagirkan ke invoice manapun — tambahkan shipment ini ke invoice perusahaan customer sebelum pickup.",
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    const notes = str(body.notes) ?? pickup.notes;

    // Aturan baru: kurir tidak menarik pembayaran dari customer. B2C ditanggung
    // Marketing, B2B via invoice. Body `payment` diabaikan jika dikirim (untuk
    // backward-compat dengan client lama). Tidak ada Payment row yang dibuat.

    // Assigned kurir name for the tracking event — fallback to confirming user.
    const kurirName = pickup.kurirId
      ? (await db.employee.findUnique({ where: { id: pickup.kurirId } }))?.name ?? user.name
      : user.name;

    const updated = await db.pickup.update({
      where: { id: pickup.id },
      // Revision Part A: the kurir picking up the package moves the task to
      // PICKED_UP — NOT COMPLETED. Completion happens later, when Admin
      // Gudang confirms the package arrived at the gudang (arrival workflow).
      data: { status: "PICKED_UP", notes },
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
      entityLabel: `${pickup.pickupCode} → PICKED_UP`,
      actor: user,
      after: { packagesScanned: `${progress.scanned}/${progress.total}`, kurir: kurirName },
    });
    return ok({ ...updated, tracking: `Picked-up by ${kurirName}` });
  });
}
