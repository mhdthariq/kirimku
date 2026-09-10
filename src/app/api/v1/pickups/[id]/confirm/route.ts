import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress, paymentSummary } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm that the kurir has PICKED UP the package from the customer.
 * Requirements:
 * - every detail barang (package) must have been QR-scanned "ok" before the
 *   kurir can confirm;
 * - DP rule: at least 50% of the price must be paid before the packages can
 *   be picked up. The kurir may record the remaining balance at pickup time
 *   via body.payment = { method, amount, reference } (recorded as CASH/TRANSFER
 *   payment by the confirming user).
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
      include: { master: { include: { details: true, customer: true } } },
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

    const body = await req.json().catch(() => ({}));
    const notes = str(body.notes) ?? pickup.notes;

    // --- DP rule: minimal 50% paid before the packages can be picked up -----
    const summary = await paymentSummary(pickup.masterId);
    if (summary.priceAmount != null && summary.priceAmount > 0 && !summary.dpOk) {
      return fail(
        422,
        `DP belum cukup — minimal 50% dari ${"Rp"}${Math.round(summary.priceAmount).toLocaleString("id-ID")} (terbayar ${"Rp"}${Math.round(summary.paidAmount).toLocaleString("id-ID")}). Catat pembayaran DP terlebih dahulu.`,
      );
    }

    // --- Optional balance payment collected by the kurir at pickup time -----
    let paymentRecorded: { amount: number; method: string } | null = null;
    const paymentInput = body.payment as { method?: unknown; amount?: unknown; reference?: unknown } | undefined;
    const balanceAmount = num(paymentInput?.amount);
    if (paymentInput && balanceAmount != null && balanceAmount > 0) {
      const method = paymentInput.method === "TRANSFER" ? "TRANSFER" : "CASH";
      const payment = await db.payment.create({
        data: {
          masterId: pickup.masterId,
          method,
          amount: balanceAmount,
          status: "RECORDED",
          reference: str(paymentInput.reference) ?? `SISA-${pickup.pickupCode}`,
          recordedById: user.id,
        },
      });
      paymentRecorded = { amount: payment.amount, method: payment.method };
      await audit({
        action: "created",
        entityType: "payment",
        entityId: payment.id,
        entityLabel: `${pickup.master.masterCode} · sisa diambil kurir`,
        actor: user,
        after: { amount: payment.amount, method },
      });
    }

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
        description: `Picked-up by ${kurirName}${paymentRecorded ? ` — sisa ${paymentRecorded.method} Rp${Math.round(paymentRecorded.amount).toLocaleString("id-ID")} diterima kurir` : ""}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "status_change",
      entityType: "pickup",
      entityId: pickup.id,
      entityLabel: `${pickup.pickupCode} → PICKED_UP`,
      actor: user,
      after: { packagesScanned: `${progress.scanned}/${progress.total}`, kurir: kurirName, payment: paymentRecorded },
    });
    return ok({ ...updated, tracking: `Picked-up by ${kurirName}`, paymentRecorded });
  });
}
