import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Haversine distance in meters between two coordinates. */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Record where a transport currently is (checkpoint check-in).
 *
 * Body: { checkpointId }  -> check-in at a route checkpoint (uses checkpoint coords)
 *    or { latitude, longitude } -> manual/GPS position, matched to the nearest
 *       checkpoint of the route (withinRadius computed from checkpoint radius).
 *
 * Only DEPARTED transports accept position records. A checkpoint that was
 * already recorded as passed cannot be recorded twice (422). Every shipment on
 * the transport gets a CHECKPOINT_REACHED tracking event so customer-facing
 * tracking timelines reflect linehaul progress.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.record_checkpoint");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: { route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } }, shipments: true },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    if (transport.status !== "DEPARTED") {
      return fail(422, `Transport berstatus ${transport.status} — posisi hanya bisa dicatat saat transport DEPARTED.`);
    }
    const routeCheckpoints = transport.route?.checkpoints ?? [];
    if (routeCheckpoints.length === 0) return fail(422, "Rute transport tidak memiliki checkpoint.");

    const body = await req.json().catch(() => ({}));
    const checkpointId = num(body.checkpointId);
    const latitude = num(body.latitude);
    const longitude = num(body.longitude);

    let checkpoint = routeCheckpoints.find((c) => c.id === checkpointId) ?? null;
    let recordedLat: number;
    let recordedLng: number;
    let withinRadius: boolean;
    let distance: number | null = null;

    if (checkpoint) {
      // Explicit checkpoint check-in — trust the checkpoint's own coordinates.
      recordedLat = checkpoint.latitude;
      recordedLng = checkpoint.longitude;
      withinRadius = true;
    } else if (latitude != null && longitude != null) {
      // Manual/GPS position — snap to the nearest checkpoint of the route.
      let best: { cp: (typeof routeCheckpoints)[number]; dist: number } | null = null;
      for (const cp of routeCheckpoints) {
        const dist = distanceM(latitude, longitude, cp.latitude, cp.longitude);
        if (!best || dist < best.dist) best = { cp, dist };
      }
      checkpoint = best!.cp;
      distance = best!.dist;
      recordedLat = latitude;
      recordedLng = longitude;
      withinRadius = best!.dist <= best!.cp.radiusMeters;
    } else {
      return fail(422, "Kirim checkpointId, atau latitude & longitude untuk posisi GPS.", {
        checkpointId: ["Wajib salah satu: checkpointId atau latitude+longitude."],
      });
    }

    // A checkpoint already recorded as "passed" cannot be re-recorded. Manual
    // GPS pings OUTSIDE any radius are always allowed (position breadcrumbs).
    if (withinRadius) {
      const existing = await db.checkpointRecord.findFirst({
        where: { transportId: transport.id, checkpointId: checkpoint.id, withinRadius: true },
      });
      if (existing) {
        return fail(422, `Checkpoint ${checkpoint.name} sudah tercatat dilewati pada ${existing.recordedAt.toISOString()}.`);
      }
    }

    const record = await db.checkpointRecord.create({
      data: {
        transportId: transport.id,
        checkpointId: checkpoint.id,
        latitude: recordedLat,
        longitude: recordedLng,
        withinRadius,
        recordedById: user.id,
      },
    });

    const seq = checkpoint.sequence;
    const total = routeCheckpoints.length;
    for (const s of transport.shipments) {
      await db.trackingEvent.create({
        data: {
          masterId: s.shipmentId,
          event: "CHECKPOINT_REACHED",
          description: withinRadius
            ? `Transport ${transport.transportCode} melewati checkpoint ${checkpoint.name} (${seq}/${total})`
            : `Posisi transport ${transport.transportCode} dekat ${checkpoint.name} (${seq}/${total}) — di luar radius checkpoint`,
          actorId: user.id,
        },
      });
    }

    await audit({
      action: "checkpoint_record",
      entityType: "transport",
      entityId: transport.id,
      entityLabel: `${transport.transportCode} @ ${checkpoint.name}`,
      actor: user,
      after: { checkpoint: checkpoint.name, sequence: seq, withinRadius, distanceM: distance, latitude: recordedLat, longitude: recordedLng },
    });

    return ok({
      id: record.id,
      transportId: transport.id,
      checkpointId: checkpoint.id,
      checkpointName: checkpoint.name,
      sequence: seq,
      totalCheckpoints: total,
      latitude: recordedLat,
      longitude: recordedLng,
      withinRadius,
      distanceM: distance,
      recordedAt: record.recordedAt,
      recordedBy: user.name,
    });
  });
}
