import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, requireNum } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Add a checkpoint to a route (click-to-place from the Leaflet editor). */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.create");
    const { id } = await params;
    const route = await db.route.findUnique({ where: { id: Number(id) }, include: { checkpoints: true } });
    if (!route) return fail(404, "Rute tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");
    const latitude = requireNum(body.latitude, "latitude", -90);
    const longitude = requireNum(body.longitude, "longitude", -180);
    if (latitude > 90) return fail(422, "Latitude maksimal 90.", { latitude: ["Latitude maksimal 90."] });
    if (longitude > 180) return fail(422, "Longitude maksimal 180.", { longitude: ["Longitude maksimal 180."] });
    const radiusMeters = Math.max(10, Math.round(requireNum(body.radiusMeters, "radiusMeters", 10)));

    const maxSequence = route.checkpoints.reduce((max, c) => Math.max(max, c.sequence), 0);
    const checkpoint = await db.checkpoint.create({
      data: { routeId: route.id, name, sequence: maxSequence + 1, latitude, longitude, radiusMeters },
    });
    await audit({
      action: "created", entityType: "checkpoint", entityId: checkpoint.id, entityLabel: `${route.name} · #${checkpoint.sequence} ${name}`,
      actor: user, after: checkpoint,
    });
    return ok(checkpoint);
  });
}
