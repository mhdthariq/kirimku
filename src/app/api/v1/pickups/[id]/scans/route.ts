import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { assertKurirAssignment, normalizeMethod, scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Record one QR scan during pickup handover.
 * Body: { payload: string, method?: "SCANNED" | "TYPED" } — the payload should
 * equal a detailCode (or the masterCode, accepted but not counted toward
 * per-package completion). `method` distinguishes camera/reader-tool scans
 * (SCANNED) from manual typing (TYPED) — visible in Riwayat Scan.
 * The code itself is never echoed back in messages (anti copy-paste).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "pickup.scan");
    const { id } = await params;
    const pickup = await db.pickup.findUnique({ where: { id: Number(id) }, include: { master: { include: { customer: { select: { type: true } }, details: true } } } });
    if (!pickup) return fail(404, "Pickup tidak ditemukan.");
    if (pickup.status === "COMPLETED") return fail(422, "Pickup sudah selesai - tidak perlu scan lagi.");
    if (pickup.status === "CANCELLED") return fail(422, "Pickup sudah dibatalkan.");

    const denied = assertKurirAssignment(pickup, user, "pickup.assign_kurir", pickup.pickupCode);
    if (denied) return fail(403, denied);

    const body = await req.json().catch(() => ({}));
    const payload = requireStr(body.payload, "payload").trim();
    const method = normalizeMethod(body.method);

    const isB2B = pickup.master.customer?.type === "b2b";

    // Master-level scan — for B2B shipments this satisfies the ENTIRE pickup
    // (single Master Resi scan covers all packages in the consignment). For
    // B2C the master scan is recorded but per-package scanning is still
    // required.
    if (payload === pickup.master.masterCode || payload === pickup.pickupCode) {
      const scan = await db.handoverScan.create({
        data: { pickupId: pickup.id, context: "pickup", scanLevel: "master", detailId: null, payload, result: "ok", method, scannedById: user.id },
      });
      const progress = await scanProgress({ pickupId: pickup.id });
      return ok({
        scan,
        message: isB2B
          ? "Master Resi B2B terbaca - semua paket pada konsinyasi ini otomatis ter-scan. Silakan konfirmasi pickup."
          : "QR master terbaca - lanjut scan semua paket (detail barang).",
        progress,
      });
    }

    const detail = pickup.master.details.find((d) => d.detailCode === payload);
    if (!detail) {
      const scan = await db.handoverScan.create({
        data: { pickupId: pickup.id, context: "pickup", scanLevel: "detail", detailId: null, payload, result: "unexpected", method, scannedById: user.id },
      });
      return ok({
        scan,
        message: "Kode tidak dikenali - tidak cocok dengan detail barang manapun pada shipment ini.",
        progress: await scanProgress({ pickupId: pickup.id }),
      });
    }

    const progressBefore = await scanProgress({ pickupId: pickup.id });
    const alreadyScanned = progressBefore.details.find((d) => d.id === detail.id)?.scanned;
    const scan = await db.handoverScan.create({
      data: {
        pickupId: pickup.id,
        context: "pickup",
        scanLevel: "detail",
        detailId: detail.id,
        payload,
        result: alreadyScanned ? "duplicate" : "ok",
        method,
        scannedById: user.id,
      },
    });
    // Revision Part A — scanning packages is verification only; the pickup
    // stays ASSIGNED until the kurir confirms the physical handover (→
    // PICKED_UP). No IN_PROGRESS transitional state in the new lifecycle.
    await audit({
      action: alreadyScanned ? "duplicate_scan" : "scanned",
      entityType: "pickup",
      entityId: pickup.id,
      entityLabel: `${pickup.pickupCode} · ${method}`,
      actor: user,
    });
    const progress = await scanProgress({ pickupId: pickup.id });
    return ok({
      scan,
      message: alreadyScanned
        ? "Paket ini sudah pernah discan."
        : progress.allScanned
          ? "Semua paket sudah discan - silakan konfirmasi pickup."
          : `Paket OK (${progress.scanned}/${progress.total}) · ${method === "SCANNED" ? "scan" : "diketik"}.`,
      progress,
    });
  });
}
