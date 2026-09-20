import { db } from "@/lib/db";
import { validateProfitShare } from "@/lib/wallet";

/**
 * Partner provisioning (Revise.md §3/§12): a user holding the marketing or
 * vehicle-owner role IS a partner — ensure the Partner profile (+ wallet)
 * exists. Type is derived from the assigned role; an existing profile keeps
 * its configured profit-sharing values.
 *
 * Revise round 10 — `defaults.warehouseId` is now supported so the Access UI
 * can attach a marketing partner to a specific gudang at the moment the user
 * is created. Only marketing partners are aligned (vehicle owners move
 * freely between gudangs); null = "umum" / general.
 */
export async function ensurePartnerProfile(
  userId: number,
  roleSlugs: string[],
  defaults?: { companyPercent?: number; partnerPercent?: number; warehouseId?: number | null },
): Promise<void> {
  const isMarketing = roleSlugs.includes("marketing");
  const isVehicleOwner = roleSlugs.includes("vehicle-owner");
  if (!isMarketing && !isVehicleOwner) return;
  const type = isMarketing ? "MARKETING" : "VEHICLE_OWNER";
  const existing = await db.partner.findUnique({ where: { userId } });
  // Revise round 10 — warehouse alignment only applies to MARKETING partners.
  // For VEHICLE_OWNER we ignore it entirely.
  const warehouseId = isMarketing ? (defaults?.warehouseId ?? null) : null;
  if (existing) {
    if (existing.type !== type) {
      await db.partner.update({ where: { id: existing.id }, data: { type } });
    }
    // Revise round 10 — when warehouseId was explicitly passed (including
    // null = "umum"), update the alignment on the existing partner too.
    // This lets the Access UI change a marketing partner's gudang from the
    // user edit form without going through the Partners page.
    if (isMarketing && defaults && defaults.warehouseId !== undefined) {
      const targetWarehouseId = defaults.warehouseId === null ? null : defaults.warehouseId;
      if (targetWarehouseId !== existing.warehouseId) {
        // Validate the warehouse exists when not null.
        if (targetWarehouseId != null) {
          const wh = await db.warehouse.findUnique({ where: { id: targetWarehouseId } });
          if (!wh || !wh.isActive) {
            throw new Error("WAREHOUSE_NOT_FOUND");
          }
        }
        await db.partner.update({ where: { id: existing.id }, data: { warehouseId: targetWarehouseId } });
      }
    }
    return;
  }
  const companyPercent = defaults?.companyPercent ?? 80;
  const partnerPercent = defaults?.partnerPercent ?? 20;
  validateProfitShare(companyPercent, partnerPercent);
  // Validate warehouseId (when set + non-null) before creating the partner.
  if (warehouseId != null) {
    const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || !wh.isActive) {
      throw new Error("WAREHOUSE_NOT_FOUND");
    }
  }
  const partner = await db.partner.create({
    data: { userId, type, companyPercent, partnerPercent, warehouseId },
  });
  await db.wallet.create({ data: { partnerId: partner.id } }).catch(() => undefined);
}

