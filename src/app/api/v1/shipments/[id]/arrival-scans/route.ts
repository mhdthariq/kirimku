import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { normalizeMethod, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/** Arrival scan progress for a shipment (gudang_arrival context). */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "shipment.view");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    const progress = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
    return ok({ progress });
  });
}

/**
 * Record one package scan while a kurir drops off picked-up packages at the
 * gudang (Admin Gudang flow). Body: { payload, method } where method is
 * "SCANNED" (phone camera / reader tool) or "TYPED" (typed manually).
 * Response messages never echo the code back (anti copy-paste).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.confirm_arrival");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) }, include: { details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (master.status !== "PICKED_UP") {
      return fail(422, `Konfirmasi tiba di gudang hanya untuk shipment PICKED_UP (saat ini: ${master.status}).`);
    }

    const body = await req.json().catch(() => ({}));
    const payload = requireStr(body.payload, "payload").trim();
    const method = normalizeMethod(body.method);

    const detail = master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: {
          masterId: master.id,
          context: "gudang_arrival",
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
        progress: await scanProgress({ masterId: master.id, context: "gudang_arrival" }),
      });
    }

    const progressBefore = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        masterId: master.id,
        context: "gudang_arrival",
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
      entityLabel: `${master.masterCode} · gudang_arrival · ${method}`,
      actor: user,
    });
    const progress = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
    return ok({
      scan,
      message: alreadyScanned
        ? "Paket ini sudah pernah discan."
        : progress.allScanned
          ? "Semua paket sudah discan — siap konfirmasi tiba di gudang."
          : `Paket OK (${progress.scanned}/${progress.total}) · ${method === "SCANNED" ? "scan" : "diketik"}.`,
      progress,
    });
  });
}
