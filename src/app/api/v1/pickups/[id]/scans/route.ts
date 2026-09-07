import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Record one QR scan during pickup handover.
 * Body: { payload: string } — the QR payload should equal a detailCode
 * (or the masterCode, which is accepted but does not count toward
 * per-package completion).
 * Response: { scan, progress } — progress.allScanned gates confirmation.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "pickup.scan");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({ where: { id: Number(id) }, include: { master: { include: { details: true } } } });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    if (pickup.status === "COMPLETED") return fail(422, "Pickup sudah selesai — tidak perlu scan lagi.");
    if (pickup.status === "CANCELLED") return fail(422, "Pickup sudah dibatalkan.");

    const denied = assertKurirAssignment(pickup, user, "pickup.assign_kurir", pickup.pickupCode);
    if (denied) return fail(403, denied);

    const body = await req.json().catch(() => ({}));
    const payload = requireStr(body.payload, "payload").trim();

    // Master-level scan: accepted, recorded, but per-package scanning is still required.
    if (payload === pickup.master.masterCode || payload === pickup.pickupCode) {
      const scan = await db.handoverScan.create({
        data: { pickupId: pickup.id, scanLevel: "master", detailId: null, payload, result: "ok", scannedById: user.id },
      });
      return ok({ scan, message: "QR master terbaca — lanjut scan semua paket (detail barang).", progress: await scanProgress({ pickupId: pickup.id }) });
    }

    const detail = pickup.master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: { pickupId: pickup.id, scanLevel: "detail", detailId: null, payload, result: "unexpected", scannedById: user.id },
      });
      return ok({
        scan,
        message: `QR "${payload}" tidak dikenali — tidak cocok dengan detail barang manapun pada shipment ini.`,
        progress: await scanProgress({ pickupId: pickup.id }),
      });
    }

    const progressBefore = await scanProgress({ pickupId: pickup.id });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        pickupId: pickup.id,
        scanLevel: "detail",
        detailId: detail.id,
        payload,
        result: alreadyScanned ? "duplicate" : "ok",
        scannedById: user.id,
      },
    });
    if (pickup.status === "ASSIGNED") {
      await db.pickup.update({ where: { id: pickup.id }, data: { status: "IN_PROGRESS" } });
    }
    await audit({
      action: alreadyScanned ? "duplicate_scan" : "scanned",
      entityType: "pickup",
      entityId: pickup.id,
      entityLabel: `${pickup.pickupCode} · ${payload}`,
      actor: user,
    });
    const progress = await scanProgress({ pickupId: pickup.id });
    return ok({
      scan,
      message: alreadyScanned
        ? `Paket ${payload} sudah pernah discan.`
        : progress.allScanned
          ? "Semua paket sudah discan — silakan konfirmasi pickup."
          : `Paket ${payload} OK (${progress.scanned}/${progress.total}).`,
      progress,
    });
  });
}
