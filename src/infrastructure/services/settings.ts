import { db } from "@/infrastructure/persistence/db";
import { DEFAULT_WARNING_THRESHOLD } from "@/domain/capacity";

/**
 * Company-level system settings (Capacity Round).
 *
 * Stored in the `SystemSetting` key/value table. Only the Owner can write
 * (via PUT /api/v1/settings); everyone reads via GET /api/v1/settings.
 *
 * The capacity warning threshold defaults to 90% (plan §31 SOFT limit) and
 * is overridable per company. It controls when a dimension flips from
 * OK → WARNING (near-limit, but not yet OVERLIMIT). Still informational.
 */

export const SETTING_CAPACITY_WARNING_THRESHOLD = "capacity.warningThresholdPct";

// --- tiny in-memory TTL cache ------------------------------------------------
// The threshold is read on every capacity-computing request (transports list,
// detail, dashboard, fleet-capacity, drops, partner transports). To avoid a
// DB round-trip per request, cache it for a short TTL. The PUT /settings
// endpoint calls invalidateCapacitySettingsCache() after a write so the new
// value is visible immediately.
const CACHE_TTL_MS = 10_000; // 10 seconds
let cachedThreshold: { value: number; expiresAt: number } | null = null;

/** Invalidate the in-memory cache (call after a settings write). */
export function invalidateCapacitySettingsCache(): void {
  cachedThreshold = null;
}

/** Read the capacity warning threshold (%) — falls back to the 90% default. */
export async function getCapacityWarningThreshold(): Promise<number> {
  if (cachedThreshold && cachedThreshold.expiresAt > Date.now()) {
    return cachedThreshold.value;
  }
  try {
    const row = await db.systemSetting.findUnique({
      where: { key: SETTING_CAPACITY_WARNING_THRESHOLD },
      select: { value: true },
    });
    if (row) {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0 && n < 1000) {
        cachedThreshold = { value: n, expiresAt: Date.now() + CACHE_TTL_MS };
        return n;
      }
    }
  } catch {
    // table may not exist yet on a fresh DB before db:push — fall back to default.
  }
  return DEFAULT_WARNING_THRESHOLD;
}

/** All known capacity-related settings as a plain object (for the API). */
export async function getCapacitySettings() {
  const warningThresholdPct = await getCapacityWarningThreshold();
  return { warningThresholdPct };
}
