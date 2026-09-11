import { db } from "@/lib/db";
import { validateProfitShare } from "@/lib/wallet";

/**
 * Partner provisioning (Revise.md §3/§12): a user holding the marketing or
 * vehicle-owner role IS a partner — ensure the Partner profile (+ wallet)
 * exists. Type is derived from the assigned role; an existing profile keeps
 * its configured profit-sharing values.
 */
export async function ensurePartnerProfile(
  userId: number,
  roleSlugs: string[],
  defaults?: { companyPercent?: number; partnerPercent?: number },
): Promise<void> {
  const isMarketing = roleSlugs.includes("marketing");
  const isVehicleOwner = roleSlugs.includes("vehicle-owner");
  if (!isMarketing && !isVehicleOwner) return;
  const type = isMarketing ? "MARKETING" : "VEHICLE_OWNER";
  const existing = await db.partner.findUnique({ where: { userId } });
  if (existing) {
    if (existing.type !== type) {
      await db.partner.update({ where: { id: existing.id }, data: { type } });
    }
    return;
  }
  const companyPercent = defaults?.companyPercent ?? 80;
  const partnerPercent = defaults?.partnerPercent ?? 20;
  validateProfitShare(companyPercent, partnerPercent);
  const partner = await db.partner.create({
    data: { userId, type, companyPercent, partnerPercent },
  });
  await db.wallet.create({ data: { partnerId: partner.id } }).catch(() => undefined);
}
