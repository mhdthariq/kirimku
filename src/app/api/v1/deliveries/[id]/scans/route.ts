import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Record one QR scan during delivery handover to the customer.
 * Body: { payload: string } — QR payload should equal a detailCode.
 * When every package of the shipment is scanned "ok", the kurir may
 * confirm delivery (POST /deliveries/{id}/complete) with proof of delivery.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "delivery.scan");
    const { id } = await params;
    const delivery = await db.delivery.findUnique({ where: { id: Number(id) }, include: { master: { include: { details: true } } } });
    if (!delivery) return fail(404, "Delivery tidak ditemukan.");
    if (delivery.status === "COMPLETED") return fail(422, "Delivery sudah selesai — tidak perlu scan lagi.");
    if (delivery.status === "FAILED") return fail(422, "Delivery ditandai gagal.");

    const denied = assertKurirAssignment(delivery, user, "delivery.assign_kurir", delivery.deliveryCode);
    if (denied) return fail(403, denied);

    const body = await req.json().catch(() => ({}));
    const payload = requireStr(body.payload, "payload").trim();

    if (payload === delivery.master.masterCode || payload === delivery.deliveryCode) {
      const scan = await db.handoverScan.create({
        data: { deliveryId: delivery.id, scanLevel: "master", detailId: null, payload, result: "ok", scannedById: user.id },
      });
      return ok({ scan, message: "QR master terbaca — lanjut scan semua paket untuk customer ini.", progress: await scanProgress({ deliveryId: delivery.id }) });
    }

    const detail = delivery.master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: { deliveryId: delivery.id, scanLevel: "detail", detailId: null, payload, result: "unexpected", scannedById: user.id },
      });
      return ok({
        scan,
        message: `QR "${payload}" tidak dikenali — bukan paket untuk shipment ini.`,
        progress: await scanProgress({ deliveryId: delivery.id }),
      });
    }

    const progressBefore = await scanProgress({ deliveryId: delivery.id });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        deliveryId: delivery.id,
        scanLevel: "detail",
        detailId: detail.id,
        payload,
        result: alreadyScanned ? "duplicate" : "ok",
        scannedById: user.id,
      },
    });
    await audit({
      action: alreadyScanned ? "duplicate_scan" : "scanned",
      entityType: "delivery",
      entityId: delivery.id,
      entityLabel: `${delivery.deliveryCode} · ${payload}`,
      actor: user,
    });
    const progress = await scanProgress({ deliveryId: delivery.id });
    return ok({
      scan,
      message: alreadyScanned
        ? `Paket ${payload} sudah pernah discan.`
        : progress.allScanned
          ? "Semua paket sudah discan — silakan konfirmasi serah terima ke customer."
          : `Paket ${payload} OK (${progress.scanned}/${progress.total}).`,
      progress,
    });
  });
}
