import { NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertTransportAccess, isAssignedCrew, parseOptionalPhoto } from "@/infrastructure/services/transport-ops-server";
import { activityCaptureError } from "@/shared/activity-tracking";

type Params = { params: Promise<{ id: string }> };

async function loadTransport(id: string) {
  return db.transport.findUnique({
    where: { id: Number(id) },
    include: { route: true, shipments: { include: { master: true } } },
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.view");
    const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return fail(422, "ID transport tidak valid.");
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    if (transport.trackingMode !== "ACTIVITY") return fail(422, "Transport ini tidak menggunakan activity tracking.");
    const activities = await db.transportActivity.findMany({
      where: { transportId: transport.id },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
    return ok(activities);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.checkin");
    const { id } = await params;
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return fail(422, "ID transport tidak valid.");
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);
    // Even owners need a crew assignment to submit driver evidence.
    if (!isAssignedCrew(user, transport)) return fail(403, "Hanya driver/kenek yang ditugaskan yang boleh mencatat aktivitas.");
    if (transport.trackingMode !== "ACTIVITY") return fail(422, "Transport ini tidak mendukung activity tracking.");
    if (!["PLANNED", "DEPARTED"].includes(transport.status)) return fail(422, "Aktivitas hanya untuk transport PLANNED atau DEPARTED.");

    const parsed: unknown = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(422, "Payload aktivitas tidak valid.");
    const body = parsed as Record<string, unknown>;
    const captureError = activityCaptureError(body);
    if (captureError) return fail(422, captureError);
    const photo = parseOptionalPhoto(body.photo);
    if (photo.error) return fail(422, photo.error, { photo: [photo.error] });
    if (!photo.photoUrl) return fail(422, "Foto aktivitas wajib disertakan.");
    const base64 = photo.photoUrl.slice(photo.photoUrl.indexOf(",") + 1);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64) return fail(422, "Data foto tidak valid.");
    try {
      const metadata = await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 20_000_000 }).metadata();
      const expectedFormat = photo.photoUrl.startsWith("data:image/png;") ? "png" : "jpeg";
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) return fail(422, "Data foto tidak sesuai format gambar.");
    } catch {
      return fail(422, "Data foto tidak valid.");
    }

    const capturedAt = new Date(body.capturedAt as string);
    const location = {
      latitude: body.latitude as number,
      longitude: body.longitude as number,
      locationAccuracy: (body.locationAccuracy as number | null | undefined) ?? null,
    };
    const activity = await db.$transaction(async (tx) => {
      // Lock and recheck lifecycle/mode/assignment before writing evidence.
      const active = await tx.transport.updateMany({
        where: { id: transport.id, trackingMode: "ACTIVITY", transportMode: transport.transportMode, status: { in: ["PLANNED", "DEPARTED"] },
          OR: [{ driverId: user.employeeId! }, { kenekId: user.employeeId! }] },
        data: { updatedAt: new Date() },
      });
      if (!active.count) throw new HttpError(409, "Transport berubah; muat ulang sebelum mencatat aktivitas.");
      const created = await tx.transportActivity.create({ data: {
        transportId: transport.id, photoUrl: photo.photoUrl!, ...location, capturedAt,
        recordedById: user.id, recordedByUsername: user.username,
      } });
      // A slightly older capture must not move the last known position backwards.
      await tx.transport.updateMany({
        where: { id: transport.id, OR: [{ lastLocationAt: null }, { lastLocationAt: { lte: capturedAt } }] },
        data: { currentLatitude: location.latitude, currentLongitude: location.longitude, lastLocationAt: capturedAt },
      });
      return created;
    });
    await audit({ action: "activity", entityType: "transport", entityId: transport.id,
      entityLabel: `${transport.transportCode} · aktivitas`, actor: user,
      after: { activityId: activity.id, ...location, capturedAt, hasPhoto: true } });
    return ok(activity);
  });
}
