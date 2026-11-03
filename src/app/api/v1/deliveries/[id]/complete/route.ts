import { NextRequest } from "next/server";
import sharp from "sharp";
import { parseEvidenceMetadata } from "@/infrastructure/services/evidence-photo";
import { watermarkActivityPhoto } from "@/infrastructure/services/activity-watermark";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, requireStr, str } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertKurirAssignment, scanProgress } from "@/infrastructure/services/scan-flow";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";

type Params = { params: Promise<{ id: string }> };

/**
 * Complete a delivery (handover to customer).
 * Requirement: every package must be QR-scanned "ok" first, plus a
 * proof-of-delivery note (receiver name). On success the shipment becomes
 * DELIVERED and tracking records who received the package.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "delivery.confirm");
    const { id } = await params;
    const delivery = await db.delivery.findUnique({
      where: { id: Number(id) },
      include: { master: { include: { details: true, customer: true } } },
    });
    if (!delivery) return fail(404, "Delivery tidak ditemukan.");
    await assertShipmentScope(user, delivery.master);
    if (delivery.status === "COMPLETED") return fail(422, "Delivery sudah selesai.");
    if (delivery.status === "FAILED") return fail(422, "Delivery ditandai gagal - buat task baru bila perlu.");

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

    const parsed = await req.json().catch(() => null);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const evidence = parseEvidenceMetadata(body);
    if ("error" in evidence) return fail(422, evidence.error);
    const { metadata } = evidence;
    const hasLocation = body.latitude !== undefined || body.longitude !== undefined;
    if (hasLocation && (typeof body.latitude !== "number" || !Number.isFinite(body.latitude) || Math.abs(body.latitude) > 90 ||
      typeof body.longitude !== "number" || !Number.isFinite(body.longitude) || Math.abs(body.longitude) > 180)) {
      return fail(422, "Koordinat GPS tidak valid.");
    }
    const proof = requireStr(body.proofOfDelivery, "proofOfDelivery");
    const notes = str(body.notes) ?? delivery.notes;
    // Step 5 — proof photo (REQUIRED). Same validation as the pickup confirm
    // route: non-empty JPEG / PNG data URL under 2.5MB. Stored on
    // `Delivery.photoUrl` and surfaced in the deliveries list / detail
    // dialog gated by `proof_photo.view` (Admin Gudang + Owner).
    const MAX_PHOTO_BYTES = 2_500_000;
    let photoUrl = typeof body.photoUrl === "string" ? body.photoUrl : "";
    if (!photoUrl) {
      return fail(422, "Foto bukti serah terima wajib disertakan sebelum konfirmasi.");
    }
    if (!photoUrl.startsWith("data:image/jpeg;base64,") && !photoUrl.startsWith("data:image/png;base64,")) {
      return fail(422, "Format foto tidak didukung - gunakan JPEG atau PNG.");
    }
    if (photoUrl.length > MAX_PHOTO_BYTES) {
      return fail(422, "Foto terlalu besar (maks ±2.5 MB setelah kompresi).");
    }

    const kurirName = delivery.kurirId
      ? (await db.employee.findUnique({ where: { id: delivery.kurirId } }))?.name ?? user.name
      : user.name;
    const customerName = delivery.master.customer.name;

    // Step 4 — DIRECT shipments: the driver is at the final checkpoint of
    // the transport carrying this master (they just scanned the MasterResi /
    // packages there before handover). Look up the most-recent checkpoint
    // record for that transport to get the checkpoint name, then build the
    // customer-facing tracking description "Delivery Success on '{checkpoint
    // name}'" the user requested. STANDARD deliveries keep the existing
    // "Delivered to {customer} by [kurir] — received by: [proof]" wording
    // (those handovers happen at the customer's door, not at a transport
    // checkpoint).
    const isDirect = (delivery.master.fulfillmentMode ?? "STANDARD") === "DIRECT";
    let trackingDescription = `Delivered to ${customerName} by ${kurirName} - received by: ${proof}`;
    if (isDirect) {
      const transport = await db.transport.findFirst({
        where: { shipments: { some: { shipmentId: delivery.masterId } } },
        include: {
          route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
          checkpointRecords: { orderBy: { recordedAt: "desc" }, take: 1, include: { checkpoint: true } },
        },
      });
      const latestCheckpointName = transport?.checkpointRecords[0]?.checkpoint?.name ?? null;
      if (latestCheckpointName) {
        trackingDescription = `Delivery Success on '${latestCheckpointName}'`;
      }
    }

    try {
      if (hasLocation) {
        photoUrl = await watermarkActivityPhoto(photoUrl, {
          ...metadata, latitude: body.latitude, longitude: body.longitude, locationAccuracy: body.locationAccuracy ?? null,
          recordedBy: user.name, label: `Delivery ${delivery.deliveryCode}`,
          origin: delivery.master.origin, destination: delivery.master.destination,
          shipmentCount: 1, driverName: kurirName,
        });
      } else {
        // Task/map coordinates are not evidence of the device's capture location.
        await sharp(Buffer.from(photoUrl.slice(photoUrl.indexOf(",") + 1), "base64"), { limitInputPixels: 20_000_000 }).resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
      }
    } catch {
      return fail(422, "Foto bukti tidak dapat diproses. Ambil ulang foto.");
    }

    const { updated } = await db.$transaction(async (tx) => {
      const result = await tx.delivery.update({
        where: { id: delivery.id },
        // Step 5 — persist the proof photo URL on the delivery row.
        data: { status: "COMPLETED", completedAt: new Date(), proofOfDelivery: proof, notes, photoUrl, ...metadata,
          captureLatitude: hasLocation ? body.latitude : null,
          captureLongitude: hasLocation ? body.longitude : null,
          captureAccuracy: body.locationAccuracy ?? null,
        },
      });
      if (delivery.master.status !== "DELIVERED") {
        await tx.masterShipment.update({ where: { id: delivery.masterId }, data: { status: "DELIVERED" } });
      }
      await tx.trackingEvent.create({
        data: {
          masterId: delivery.masterId,
          event: "DELIVERED",
          description: trackingDescription,
          actorId: user.id,
        },
      });
      return { updated: result };
    });
    await audit({
      action: "status_change",
      entityType: "delivery",
      entityId: delivery.id,
      entityLabel: `${delivery.deliveryCode} → COMPLETED`,
      actor: user,
      after: { packagesScanned: `${progress.scanned}/${progress.total}`, proof, kurir: kurirName, hasPhoto: true },
    });
    return ok({ ...updated, tracking: trackingDescription });
  });
}
