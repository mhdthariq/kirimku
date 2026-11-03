import { hasPermission, type AuthUser } from "@/infrastructure/auth/auth";

/** Capture metadata is as sensitive as the coordinates baked into proof photos. */
export function withProofVisibility<T extends { photoUrl?: string | null }>(user: AuthUser | null, record: T) {
  if (hasPermission(user, "proof_photo.view")) return { ...record, photoUrl: record.photoUrl ?? null };

  const {
    locationLabel: _locationLabel, timeZone: _timeZone, capturedAt: _capturedAt,
    mockLocation: _mockLocation, captureLatitude: _captureLatitude,
    captureLongitude: _captureLongitude, captureAccuracy: _captureAccuracy,
    ...rest
  } = record as T & {
    locationLabel?: unknown; timeZone?: unknown; capturedAt?: unknown; mockLocation?: unknown;
    captureLatitude?: unknown; captureLongitude?: unknown; captureAccuracy?: unknown;
  };
  return { ...rest, photoUrl: null };
}
