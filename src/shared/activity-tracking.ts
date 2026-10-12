export type TrackingMode = "CHECKPOINT" | "ACTIVITY";

export function parseTrackingMode(value: unknown): TrackingMode | null {
  if (value === undefined) return "CHECKPOINT";
  return value === "CHECKPOINT" || value === "ACTIVITY" ? value : null;
}

/** Capture freshness is a payload constraint, not proof of camera/GPS provenance. */
export function activityCaptureError(body: Record<string, unknown>, now = Date.now()): string | null {
  if (typeof body.latitude !== "number" || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) return "Latitude harus angka -90..90.";
  if (typeof body.longitude !== "number" || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return "Longitude harus angka -180..180.";
  if (body.locationAccuracy != null && (typeof body.locationAccuracy !== "number" || !Number.isFinite(body.locationAccuracy) || body.locationAccuracy < 0)) return "Akurasi lokasi harus angka non-negatif.";
  if (typeof body.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.capturedAt)) return "Waktu pengambilan foto wajib berupa timestamp dengan zona waktu.";
  const capturedAt = Date.parse(body.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt < now - 5 * 60_000 || capturedAt > now + 30_000) return "Foto dan GPS harus baru diambil (maksimal 5 menit, toleransi waktu 30 detik).";
  return null;
}
