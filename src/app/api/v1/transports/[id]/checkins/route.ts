import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { haversineMeters, metersToKmDisplay } from "@/lib/transport-totals";
import { shipmentDestinationGudangIds, cityIndex } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

const MAX_PHOTO_BYTES = 2_500_000; // ~2.5 MB after client-side compression

/**
 * Checkpoint selfie check-in (Revision Part O) + location-based arrival
 * detection (Revision Part N).
 *
 * Body: { checkpointId, latitude, longitude, photo: dataURL }
 *
 * Rules:
 * - only the ASSIGNED driver / kenek (or the owner) may check in — enforced
 *   server-side (Part Y), never via frontend hiding;
 * - photo/selfie evidence is REQUIRED (client compresses to ~720px JPEG);
 * - the server independently recomputes the distance to the checkpoint and
 *   REJECTS the check-in when the user is outside the configured radius —
 *   frontend-supplied locations are never trusted as-is (Part Z);
 * - the recorded timestamp is SERVER time (client timestamps are ignored);
 * - checking in at the FINAL checkpoint inside its radius automatically
 *   completes the transport's arrival (Part N — no manual Arrived button).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.checkin");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } },
        driver: true,
        kenek: true,
        shipments: { include: { master: true } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");

    // ---- assignment enforcement (driver / kenek / owner only) --------------
    if (!user.isOwner && !user.permissions.includes("*")) {
      const isCrew =
        user.employeeId != null &&
        (transport.driverId === user.employeeId || transport.kenekId === user.employeeId);
      if (!isCrew) {
        return fail(403, "Hanya driver/kenek yang ditugaskan pada transport ini yang boleh check-in.");
      }
    }

    if (!(["PLANNED", "DEPARTED"] as string[]).includes(transport.status)) {
      return fail(422, `Check-in hanya untuk transport PLANNED atau DEPARTED (saat ini: ${transport.status}).`);
    }

    const body = await req.json().catch(() => ({}));
    const checkpointId = Number(body.checkpointId);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(checkpointId)) return fail(422, "Checkpoint wajib dipilih.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return fail(422, "Latitude tidak valid.", { latitude: ["Latitude harus angka -90..90."] });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return fail(422, "Longitude tidak valid.", { longitude: ["Longitude harus angka -180..180."] });
    }

    const checkpoint = transport.route?.checkpoints.find((c) => c.id === checkpointId && c.isActive);
    if (!checkpoint) return fail(422, "Checkpoint tidak ditemukan pada rute transport ini.");

    // ---- photo evidence (required) -----------------------------------------
    const photo = typeof body.photo === "string" ? body.photo : "";
    if (!photo) return fail(422, "Foto selfie di checkpoint wajib disertakan sebagai bukti check-in.");
    if (!photo.startsWith("data:image/jpeg;base64,") && !photo.startsWith("data:image/png;base64,")) {
      return fail(422, "Format foto tidak didukung — gunakan JPEG atau PNG.");
    }
    if (photo.length > MAX_PHOTO_BYTES) {
      return fail(422, "Foto terlalu besar (maks ±2.5 MB setelah kompresi).");
    }

    // ---- server-side geographic validation (never trust the client) -------
    const distance = haversineMeters(latitude, longitude, checkpoint.latitude, checkpoint.longitude);
    if (distance > checkpoint.radiusMeters) {
      return fail(422, `Jarak Anda ${metersToKmDisplay(distance)} KM dari checkpoint — radius validasi hanya ${metersToKmDisplay(checkpoint.radiusMeters)} KM. Mendekatlah ke checkpoint lalu ulangi check-in.`, {
        distance: [`distance ${distance} m > radius ${checkpoint.radiusMeters} m`],
      });
    }

    // ---- duplicate guard: same user, same checkpoint, within 2 minutes ----
    const recent = await db.checkpointRecord.findFirst({
      where: {
        transportId: transport.id,
        checkpointId: checkpoint.id,
        recordedById: user.id,
        recordedAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
    });
    if (recent) {
      return fail(422, "Anda baru saja check-in di checkpoint ini — tunggu sebentar sebelum check-in ulang.");
    }

    const isFinalCheckpoint =
      transport.route != null &&
      checkpoint.sequence === Math.max(...transport.route.checkpoints.map((c) => c.sequence));
    const isFirstCheckpoint =
      transport.route != null &&
      checkpoint.sequence === Math.min(...transport.route.checkpoints.map((c) => c.sequence));
    const autoDeparted = transport.status === "PLANNED" && isFirstCheckpoint;

    const record = await db.$transaction(async (tx) => {
      const created = await tx.checkpointRecord.create({
        data: {
          transportId: transport.id,
          checkpointId: checkpoint.id,
          latitude,
          longitude,
          withinRadius: true,
          photoUrl: photo,
          distanceMeters: distance,
          recordedById: user.id,
          recordedAt: new Date(),
        },
      });
      // last known transport position (Part K)
      await tx.transport.update({
        where: { id: transport.id },
        data: { currentLatitude: latitude, currentLongitude: longitude, lastLocationAt: new Date() },
      });
      if (autoDeparted) {
        await tx.transport.update({
          where: { id: transport.id },
          data: { status: "DEPARTED", departedAt: new Date() },
        });
        for (const s of transport.shipments) {
          if (s.master.status === "RECEIVED_AT_GUDANG") {
            await tx.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "IN_TRANSPORT" } });
          }
          await tx.trackingEvent.create({
            data: {
              masterId: s.shipmentId,
              event: "IN_TRANSPORT",
              description: `Transport ${transport.transportCode} berangkat melalui check-in checkpoint ${checkpoint.name}`,
              actorId: user.id,
            },
          });
        }
      }
      return created;
    });

    // ---- location-based arrival detection (Part N) -------------------------
    // Checking in INSIDE the final checkpoint's radius means the transport has
    // physically reached its destination — the backend marks it ARRIVED.
    let autoArrived = false;
    if (isFinalCheckpoint) {
      await db.$transaction(async (tx) => {
        const fresh = await tx.transport.findUnique({ where: { id: transport.id }, select: { status: true } });
        if (fresh?.status !== "DEPARTED") return;
        autoArrived = true;
        await tx.transport.update({
          where: { id: transport.id },
          data: { status: "ARRIVED", arrivedAt: new Date() },
        });
        const cityIdx = await cityIndex();
        for (const s of transport.shipments) {
          const destIds = shipmentDestinationGudangIds(s.master, cityIdx);
          const arrivedWarehouseId = s.master.destinationWarehouseId ?? destIds[0] ?? null;
          if (s.master.status === "IN_TRANSPORT") {
            await tx.masterShipment.update({
              where: { id: s.shipmentId },
              data: { status: "ARRIVED_AT_GUDANG", arrivedWarehouseId },
            });
          }
          await tx.trackingEvent.create({
            data: {
              masterId: s.shipmentId,
              event: "ARRIVED_AT_GUDANG",
              description: `Transport ${transport.transportCode} tiba di gudang tujuan (check-in ${checkpoint.name} oleh ${user.name})`,
              actorId: user.id,
            },
          });
        }
      });
      if (autoArrived) {
        await audit({
          action: "status_change",
          entityType: "transport",
          entityId: transport.id,
          entityLabel: `${transport.transportCode} → ARRIVED (auto: check-in checkpoint akhir)`,
          actor: user,
        });
      }
    }

    await audit({
      action: "checkin",
      entityType: "transport",
      entityId: transport.id,
      entityLabel: `${transport.transportCode} · ${checkpoint.name} oleh ${user.name}`,
      actor: user,
      after: { checkpoint: checkpoint.name, distanceMeters: distance, withinRadius: true, hasPhoto: true },
    });

    return ok({
      record: {
        id: record.id,
        checkpointId: checkpoint.id,
        checkpointName: checkpoint.name,
        latitude: record.latitude,
        longitude: record.longitude,
        distanceMeters: distance,
        withinRadius: true,
        recordedAt: record.recordedAt,
      },
      distanceKm: metersToKmDisplay(distance),
      radiusKm: metersToKmDisplay(checkpoint.radiusMeters),
      autoArrived,
      message: autoArrived
        ? `Check-in berhasil di ${checkpoint.name} — transport ${transport.transportCode} OTOMATIS ditandai ARRIVED (checkpoint akhir tercapai).`
        : `Check-in berhasil di ${checkpoint.name} (jarak ${metersToKmDisplay(distance)} KM, radius ${metersToKmDisplay(checkpoint.radiusMeters)} KM).`,
    });
  });
}
