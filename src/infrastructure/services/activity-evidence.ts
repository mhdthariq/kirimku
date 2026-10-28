import sharp from "sharp";
import { HttpError } from "@/shared/http-error";
import { parseOptionalPhoto } from "@/infrastructure/services/transport-ops-server";
import { activityCaptureError } from "@/shared/activity-tracking";
import { watermarkActivityPhoto, type ActivityWatermark } from "@/infrastructure/services/activity-watermark";

export async function parseActivityEvidence(req: { json(): Promise<unknown> }, watermark: Pick<ActivityWatermark, "transportCode" | "recordedBy" | "label"> = {}) {
    const parsed: unknown = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(422, "Payload aktivitas tidak valid.");
    const body = parsed as Record<string, unknown>;
    const captureError = activityCaptureError(body);
    if (captureError) throw new HttpError(422, captureError);
    const photo = parseOptionalPhoto(body.photo);
    if (photo.error) throw new HttpError(422, photo.error);
    if (!photo.photoUrl) throw new HttpError(422, "Foto aktivitas wajib disertakan.");
    const base64 = photo.photoUrl.slice(photo.photoUrl.indexOf(",") + 1);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64) throw new HttpError(422, "Data foto tidak valid.");
    try {
      const metadata = await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 20_000_000 }).metadata();
      const expectedFormat = photo.photoUrl.startsWith("data:image/png;") ? "png" : "jpeg";
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw new HttpError(422, "Data foto tidak sesuai format gambar.");
    } catch {
      throw new HttpError(422, "Data foto tidak valid.");
    }

    const capturedAt = new Date(body.capturedAt as string);
    const location = {
      latitude: body.latitude as number,
      longitude: body.longitude as number,
      locationAccuracy: (body.locationAccuracy as number | null | undefined) ?? null,
    };
    let photoUrl: string;
    try {
      photoUrl = await watermarkActivityPhoto(photo.photoUrl, { ...location, capturedAt, ...watermark });
    } catch {
      throw new HttpError(422, "Watermark foto gagal dibuat. Ambil ulang foto dan coba lagi.");
    }
    return { photoUrl, ...location, capturedAt };
}
