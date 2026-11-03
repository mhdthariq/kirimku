import { NextRequest } from "next/server";
import { guard, handle, ok } from "@/composition/api-helpers";
import { EVIDENCE_TIME_ZONES } from "@/infrastructure/services/evidence-photo";

function versionCode(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Authenticated, tenant-resolved capability discovery; never cache clock/version policy. */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req);
    const minimum = versionCode(process.env.MOBILE_ANDROID_MIN_VERSION_CODE, 1);
    const response = ok({
      serverTime: new Date().toISOString(),
      android: {
        minimumVersionCode: minimum,
        latestVersionCode: Math.max(minimum, versionCode(process.env.MOBILE_ANDROID_LATEST_VERSION_CODE, minimum)),
        distribution: process.env.MOBILE_DISTRIBUTION === "public" ? "public" : "private",
      },
      evidence: {
        timeZones: EVIDENCE_TIME_ZONES,
        defaultTimeZone: "Asia/Jakarta",
        maxLocationLabelLength: 240,
        maxPhotoDataUrlLength: 2_500_000,
        maxCaptureAgeSeconds: 300,
        maxFutureSkewSeconds: 30,
        serverWatermark: true,
        locationLabelSource: "device",
      },
      capabilities: {
        offlineCapture: false, idempotentMutations: false, refreshSessions: false,
        pushNotifications: false, mockLocationMetadata: true,
      },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
