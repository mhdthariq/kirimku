import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * "Scan all" bulk action for Admin Gudang: mark every not-yet-scanned package
 * of a PICKED_UP shipment as scanned (reader-tool batch mode) so the arrival
 * confirmation unlocks in one click.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.confirm_arrival");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) }, include: { details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (master.status !== "PICKED_UP") {
      return fail(422, `Scan semua hanya untuk shipment PICKED_UP (saat ini: ${master.status}).`);
    }

    const progressBefore = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
    if (progressBefore.details.length === 0) {
      return fail(422, "Shipment belum punya detail barang.");
    }
    const pending = progressBefore.details.filter((d) => !d.scanned);
    if (pending.length === 0) {
      return ok({ created: 0, progress: progressBefore, message: "Semua paket sudah discan." });
    }

    await db.handoverScan.createMany({
      data: pending.map((d) => ({
        masterId: master.id,
        context: "gudang_arrival",
        scanLevel: "detail",
        detailId: d.id,
        payload: d.detailCode,
        result: "ok",
        method: "SCANNED",
        scannedById: user.id,
      })),
    });
    await audit({
      action: "scanned",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} · scan-all (${pending.length} paket)`,
      actor: user,
    });
    const progress = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
    return ok({
      created: pending.length,
      progress,
      message: `${pending.length} paket ditandai ter-scan (mode reader). Semua paket lengkap — siap konfirmasi tiba di gudang.`,
    });
  });
}
