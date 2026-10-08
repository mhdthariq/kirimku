import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";

/**
 * POST /api/v1/fleet-capacity/bulk-configure-koli — Owner-only bulk action.
 *
 * Auto-suggests a maxKoli for every vehicle that has maxKoli=null, based on a
 * heuristic from maxWeightKg (heavier vehicles carry more packages):
 *   maxWeightKg <= 1500  → 40
 *   maxWeightKg <= 3000  → 60
 *   maxWeightKg <= 6000  → 100
 *   else                 → 150
 *
 * The caller can override the suggestion per vehicle by sending
 * `{ overrides: { "<vehicleId>": <koli> } }`. Returns the list of updated
 * vehicles + the suggested values. Audited as one `updated` entry per vehicle
 * (capacityConfigChanged). Informational feature — never blocks operations.
 */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "vehicle.update");
    if (!user.isOwner) {
      return fail(403, "Hanya Owner yang dapat menjalankan bulk configure.");
    }
    const body = await req.json().catch(() => ({}));
    const overrides: Record<string, number> =
      body.overrides && typeof body.overrides === "object" ? body.overrides : {};

    const suggestKoli = (maxWeightKg: number): number => {
      if (maxWeightKg <= 1500) return 40;
      if (maxWeightKg <= 3000) return 60;
      if (maxWeightKg <= 6000) return 100;
      return 150;
    };

    const unconfigured = await db.vehicle.findMany({
      where: { maxKoli: null },
      select: { id: true, vehicleNumber: true, name: true, maxWeightKg: true },
    });

    const updated: { id: number; vehicleNumber: string; maxKoli: number; suggested: boolean }[] = [];
    for (const v of unconfigured) {
      const override = overrides[String(v.id)];
      const koli = override != null && override > 0 ? Math.round(override) : suggestKoli(v.maxWeightKg);
      await db.vehicle.update({ where: { id: v.id }, data: { maxKoli: koli } });
      updated.push({ id: v.id, vehicleNumber: v.vehicleNumber, maxKoli: koli, suggested: override == null });
      await audit({
        action: "updated",
        entityType: "vehicle",
        entityId: v.id,
        entityLabel: v.vehicleNumber,
        actor: user,
        before: { maxKoli: null },
        after: { maxKoli: koli, capacityConfigChanged: true, capacityChanges: [{ field: "maxKoli", before: null, after: koli }] },
      });
    }

    return ok({ updated, count: updated.length });
  });
}
