import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, num } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { getCapacitySettings, invalidateCapacitySettingsCache, SETTING_CAPACITY_WARNING_THRESHOLD } from "@/infrastructure/services/settings";
import { DEFAULT_WARNING_THRESHOLD } from "@/domain/capacity";

/**
 * GET /api/v1/settings — public company-level capacity settings.
 * Returns the configurable capacity warning threshold (%). Everyone reads.
 *
 * PUT /api/v1/settings — Owner-only: updates a capacity setting. Currently
 * supports `warningThresholdPct` (1-99%). Validates + audits the change.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req);
    const capacity = await getCapacitySettings();
    return ok({ capacity });
  });
}

export async function PUT(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    if (!user.isOwner) {
      return fail(403, "Hanya Owner yang dapat mengubah pengaturan sistem.");
    }
    const body = await req.json().catch(() => ({}));
    const after: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    // warningThresholdPct (1-99)
    if (body.warningThresholdPct !== undefined) {
      const raw = num(body.warningThresholdPct);
      if (raw == null || raw < 1 || raw > 99) {
        return fail(422, "Warning threshold harus antara 1-99%.", { warningThresholdPct: ["Harus antara 1-99."] });
      }
      const prevRow = await db.systemSetting.findUnique({
        where: { key: SETTING_CAPACITY_WARNING_THRESHOLD },
        select: { value: true },
      });
      const prev = prevRow ? Number(prevRow.value) : DEFAULT_WARNING_THRESHOLD;
      before.warningThresholdPct = prev;
      after.warningThresholdPct = raw;
      await db.systemSetting.upsert({
        where: { key: SETTING_CAPACITY_WARNING_THRESHOLD },
        create: { key: SETTING_CAPACITY_WARNING_THRESHOLD, value: String(raw), updatedById: user.id },
        update: { value: String(raw), updatedById: user.id },
      });
    }

    if (Object.keys(after).length === 0) {
      return fail(422, "Tidak ada pengaturan yang diubah.", { body: ["Kirim warningThresholdPct."] });
    }

    await audit({
      action: "updated",
      entityType: "system_setting",
      entityLabel: "Capacity Settings",
      actor: user,
      before,
      after,
    });
    // Invalidate the in-memory cache so the new value is visible immediately.
    invalidateCapacitySettingsCache();
    return ok({ capacity: await getCapacitySettings() });
  });
}
