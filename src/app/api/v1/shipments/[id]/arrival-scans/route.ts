import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { arrivalScanContext, normalizeMethod, scanProgress } from "@/lib/scan-flow";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

/** Arrival scan progress for a shipment.
 *  - PICKED_UP → kurir drop-off at the origin gudang (gudang_arrival)
 *  - ARRIVED_AT_GUDANG → transport drop-off at the destination gudang
 *    (transport_arrival) — Admin Gudang scans every package before the
 *    shipment can be received / assigned for delivery.
 */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    const context = arrivalScanContext(master.status) ?? "gudang_arrival";
    const progress = await scanProgress({ masterId: master.id, context });
    return ok({ progress, context });
  });
}

/**
 * Record one package scan while a shipment is being received at the gudang:
 *  - kurir drop-off: shipment PICKED_UP (kurir brings picked-up packages back)
 *  - transport drop-off: shipment ARRIVED_AT_GUDANG (driver unloaded packages
 *    from the linehaul vehicle at the destination gudang)
 * Body: { payload, method } where method is "SCANNED" (phone camera / reader
 * tool) or "TYPED" (typed manually). Response messages never echo the code
 * back (anti copy-paste).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.confirm_arrival");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } , include: { details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);

    const context = arrivalScanContext(master.status);
    if (!context) {
      return fail(
        422,
        `Konfirmasi tiba di gudang hanya untuk shipment PICKED_UP (kurir) atau ARRIVED_AT_GUDANG (transport) — saat ini: ${master.status}.`,
      );
    }

    const body = await req.json().catch(() => ({}));
    const payload = requireStr(body.payload, "payload").trim();
    const method = normalizeMethod(body.method);

    const detail = master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: {
          masterId: master.id,
          context,
          scanLevel: "detail",
          detailId: null,
          payload,
          result: "unexpected",
          method,
          scannedById: user.id,
        },
      });
      return ok({
        scan,
        message: "Kode tidak dikenali — tidak cocok dengan paket manapun pada shipment ini.",
        progress: await scanProgress({ masterId: master.id, context }),
      });
    }

    const progressBefore = await scanProgress({ masterId: master.id, context });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        masterId: master.id,
        context,
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
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} · ${context} · ${method}`,
      actor: user,
    });
    const progress = await scanProgress({ masterId: master.id, context });
    const doneMessage =
      context === "transport_arrival"
        ? "Semua paket sudah discan — siap konfirmasi penerimaan dari transport."
        : "Semua paket sudah discan — siap konfirmasi tiba di gudang.";
    return ok({
      scan,
      message: alreadyScanned
        ? "Paket ini sudah pernah discan."
        : progress.allScanned
          ? doneMessage
          : `Paket OK (${progress.scanned}/${progress.total}) · ${method === "SCANNED" ? "scan" : "diketik"}.`,
      progress,
      context,
    });
  });
}
