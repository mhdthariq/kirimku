import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, HttpError } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { MIN_CHECKPOINTS } from "@/lib/shipment-flow";

type Params = { params: Promise<{ id: string }> };

interface CheckpointInput {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

function parseCheckpoint(raw: unknown, index: number): CheckpointInput {
  if (typeof raw !== "object" || raw === null) {
    throw new HttpError(422, `Checkpoint #${index + 1} tidak valid.`);
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new HttpError(422, `Nama checkpoint #${index + 1} wajib diisi.`, { name: [`Checkpoint #${index + 1}: nama wajib diisi.`] });
  }
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new HttpError(422, `Checkpoint #${index + 1}: latitude harus angka -90..90.`, { latitude: [`Checkpoint #${index + 1}: latitude tidak valid.`] });
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(422, `Checkpoint #${index + 1}: longitude harus angka -180..180.`, { longitude: [`Checkpoint #${index + 1}: longitude tidak valid.`] });
  }
  // UI sends kilometers (radiusKm); the DB stores meters. Accept either —
  // radiusMeters wins when both are present.
  let radiusMeters: number;
  if (body.radiusMeters !== undefined && body.radiusMeters !== null && body.radiusMeters !== "") {
    radiusMeters = Number(body.radiusMeters);
  } else if (body.radiusKm !== undefined && body.radiusKm !== null && body.radiusKm !== "") {
    radiusMeters = Number(body.radiusKm) * 1000;
  } else {
    radiusMeters = 250;
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 10000) {
    throw new HttpError(422, `Checkpoint #${index + 1}: radius harus antara 10 m (0.01 KM) dan 10000 m (10 KM).`, {
      radiusMeters: [`Checkpoint #${index + 1}: radius 10..10000 meter.`],
    });
  }
  const id = Number(body.id);
  return {
    id: Number.isFinite(id) && id > 0 ? id : undefined,
    name,
    latitude: Math.round(latitude * 1e7) / 1e7,
    longitude: Math.round(longitude * 1e7) / 1e7,
    radiusMeters: Math.round(radiusMeters),
  };
}

/**
 * Add ONE checkpoint to a route (kept for API compatibility / single add).
 * The primary editor flow uses the bulk PUT below — this append never removes
 * existing checkpoints.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.create");
    const { id } = await params;
    const route = await db.route.findUnique({ where: { id: Number(id) }, include: { checkpoints: true } });
    if (!route) return fail(404, "Rute tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const cp = parseCheckpoint(body, route.checkpoints.length);
    const maxSequence = route.checkpoints.reduce((max, c) => Math.max(max, c.sequence), 0);
    const checkpoint = await db.checkpoint.create({
      data: { routeId: route.id, name: cp.name, sequence: maxSequence + 1, latitude: cp.latitude, longitude: cp.longitude, radiusMeters: cp.radiusMeters },
    });
    await audit({
      action: "created", entityType: "checkpoint", entityId: checkpoint.id, entityLabel: `${route.name} · #${checkpoint.sequence} ${cp.name}`,
      actor: user, after: checkpoint,
    });
    return ok(checkpoint);
  });
}

/**
 * Bulk save (Revision Parts B / D / AA): save the WHOLE checkpoint collection
 * of a route in ONE transaction —
 *   create new checkpoints (no id), update existing ones (id), keep untouched
 *   ones, and delete only the checkpoints that were explicitly removed from
 *   the collection (missing ids).
 * The entire array replaces the route's checkpoint list in order; sequence is
 * rewritten 1..N so reordering is supported. Minimum MIN_CHECKPOINTS enforced.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.update");
    const { id } = await params;
    const route = await db.route.findUnique({
      where: { id: Number(id) },
      include: { checkpoints: { orderBy: { sequence: "asc" } } },
    });
    if (!route) return fail(404, "Rute tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const rawList = Array.isArray(body.checkpoints) ? body.checkpoints : null;
    if (!rawList) {
      return fail(422, "Body wajib berisi array `checkpoints`.", { checkpoints: ["Array checkpoints wajib ada."] });
    }
    if (rawList.length < MIN_CHECKPOINTS) {
      return fail(422, `Rute wajib memiliki minimal ${MIN_CHECKPOINTS} checkpoint (dikirim: ${rawList.length}).`);
    }
    const parsed = rawList.map(parseCheckpoint);

    // All ids referenced must belong to THIS route — prevents accidental
    // cross-route mutation through forged ids.
    const routeCheckpointIds = new Set(route.checkpoints.map((c) => c.id));
    for (const cp of parsed) {
      if (cp.id != null && !routeCheckpointIds.has(cp.id)) {
        return fail(422, `Checkpoint id ${cp.id} tidak milik rute ${route.name}.`);
      }
    }
    const sentIds = new Set(parsed.map((c) => c.id).filter((v): v is number => v != null));
    const toDelete = route.checkpoints.filter((c) => !sentIds.has(c.id)).map((c) => c.id);

    const saved = await db.$transaction(async (tx) => {
      // 1) delete only the explicitly removed checkpoints
      if (toDelete.length > 0) {
        await tx.checkpointRecord.deleteMany({ where: { checkpointId: { in: toDelete } } });
        await tx.checkpoint.deleteMany({ where: { id: { in: toDelete } } });
      }
      // 2) upsert the collection in order — update existing, create new
      const result: { id: number; sequence: number }[] = [];
      for (const [index, cp] of parsed.entries()) {
        const sequence = index + 1;
        if (cp.id != null) {
          const updated = await tx.checkpoint.update({
            where: { id: cp.id },
            data: { name: cp.name, sequence, latitude: cp.latitude, longitude: cp.longitude, radiusMeters: cp.radiusMeters },
          });
          result.push({ id: updated.id, sequence: updated.sequence });
        } else {
          const created = await tx.checkpoint.create({
            data: {
              routeId: route.id,
              name: cp.name,
              sequence,
              latitude: cp.latitude,
              longitude: cp.longitude,
              radiusMeters: cp.radiusMeters,
            },
          });
          result.push({ id: created.id, sequence: created.sequence });
        }
      }
      return result;
    });

    const createdCount = parsed.filter((c) => c.id == null).length;
    const updatedCount = parsed.length - createdCount;
    await audit({
      action: "updated",
      entityType: "route",
      entityId: route.id,
      entityLabel: `${route.name} · bulk save ${parsed.length} checkpoint`,
      actor: user,
      after: { total: parsed.length, created: createdCount, updated: updatedCount, deleted: toDelete.length },
    });

    const checkpoints = await db.checkpoint.findMany({
      where: { routeId: route.id },
      orderBy: { sequence: "asc" },
    });
    return ok({
      routeId: route.id,
      total: checkpoints.length,
      created: createdCount,
      updated: updatedCount,
      deleted: toDelete.length,
      checkpoints,
    });
  });
}
