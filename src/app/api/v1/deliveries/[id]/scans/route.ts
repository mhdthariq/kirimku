import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, normalizeMethod, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Record one QR scan during delivery handover to the customer.
 * Body: { payload, method? } — payload should equal a detailCode; method
 * "SCANNED" (camera / reader tool) vs "TYPED" (manual) shows up in Riwayat
 * Scan. Messages never echo the code back (anti copy-paste).
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
    const method = normalizeMethod(body.method);

    if (payload === delivery.master.masterCode || payload === delivery.deliveryCode) {
      const scan = await db.handoverScan.create({
        data: { deliveryId: delivery.id, context: "delivery", scanLevel: "master", detailId: null, payload, result: "ok", method, scannedById: user.id },
      });
      return ok({ scan, message: "QR master terbaca — lanjut scan semua paket untuk customer ini.", progress: await scanProgress({ deliveryId: delivery.id }) });
    }

    const detail = delivery.master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: { deliveryId: delivery.id, context: "delivery", scanLevel: "detail", detailId: null, payload, result: "unexpected", method, scannedById: user.id },
      });
      return ok({
        scan,
        message: "Kode tidak dikenali — bukan paket untuk shipment ini.",
        progress: await scanProgress({ deliveryId: delivery.id }),
      });
    }

    const progressBefore = await scanProgress({ deliveryId: delivery.id });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        deliveryId: delivery.id,
        context: "delivery",
        scanLevel: "detail",
        detailId: detail.id,
        payload,
        result: alreadyScanned ? "duplicate" : "ok",
        method,
        scannedById: user.id,
      },
    });
    await audit({
      action: alreadyScanned ? "duplicate_scan" : "scanned",
      entityType: "delivery",
      entityId: delivery.id,
      entityLabel: `${delivery.deliveryCode} · ${method}`,
      actor: user,
    });
    const progress = await scanProgress({ deliveryId: delivery.id });
    return ok({
      scan,
      message: alreadyScanned
        ? "Paket ini sudah pernah discan."
        : progress.allScanned
          ? "Semua paket sudah discan — silakan konfirmasi serah terima ke customer."
          : `Paket OK (${progress.scanned}/${progress.total}) · ${method === "SCANNED" ? "scan" : "diketik"}.`,
      progress,
    });
  });
}
