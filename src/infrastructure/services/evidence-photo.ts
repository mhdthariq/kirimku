import { activityCaptureError } from "@/shared/activity-tracking";

export const EVIDENCE_TIME_ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;
export type EvidenceTimeZone = typeof EVIDENCE_TIME_ZONES[number];
export const EVIDENCE_ZONE_LABELS: Record<EvidenceTimeZone, string> = {
  "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT",
};

/** Device metadata is descriptive, not proof of GPS/camera authenticity. */
export function parseEvidenceMetadata(body: Record<string, unknown>, now = new Date()):
  { error: string } | { metadata: { locationLabel: string | null; timeZone: EvidenceTimeZone; capturedAt: Date; mockLocation: boolean | null } } {
  if (body.locationLabel != null && (typeof body.locationLabel !== "string" || Array.from(body.locationLabel).length > 240)) {
    return { error: "Alamat lokasi harus teks maksimal 240 karakter." };
  }
  if (body.timeZone !== undefined && !EVIDENCE_TIME_ZONES.includes(body.timeZone as EvidenceTimeZone)) {
    return { error: "Zona waktu harus Asia/Jakarta, Asia/Makassar, atau Asia/Jayapura." };
  }
  if (body.mockLocation != null && typeof body.mockLocation !== "boolean") return { error: "mockLocation harus boolean." };
  if (body.locationAccuracy != null && (typeof body.locationAccuracy !== "number" || !Number.isFinite(body.locationAccuracy) || body.locationAccuracy < 0)) {
    return { error: "Akurasi lokasi harus angka non-negatif." };
  }
  if (body.capturedAt !== undefined) {
    // Reuse freshness validation without requiring GPS on legacy proof/receipt requests.
    const error = activityCaptureError({ ...body, latitude: 0, longitude: 0 }, now.getTime());
    if (error) return { error };
  }
  return { metadata: {
    locationLabel: typeof body.locationLabel === "string" ? body.locationLabel.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim() || null : null,
    timeZone: (body.timeZone ?? "Asia/Jakarta") as EvidenceTimeZone,
    capturedAt: body.capturedAt === undefined ? now : new Date(body.capturedAt as string),
    mockLocation: typeof body.mockLocation === "boolean" ? body.mockLocation : null,
  } };
}
