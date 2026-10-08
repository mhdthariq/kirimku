import { NextRequest } from "next/server";
import { guard, ok, handle } from "@/composition/api-helpers";
import { requirePartner, walletSummary } from "@/infrastructure/services/wallet";
import { db } from "@/infrastructure/persistence/db";

/**
 * GET /api/v1/wallet — own wallet summary (§24): balance, reserved, available.
 * Marketing and Vehicle Owner see ONLY their own wallet (§39).
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "wallet.view_own");
    const partner = requirePartner(user);
    const partnerRow = await db.partner.findUniqueOrThrow({
      where: { id: partner.id },
      include: { user: { select: { name: true, username: true } }, _count: { select: { vehicles: true } } },
    });
    const summary = await walletSummary(partner.id);
    return ok({
      ...summary,
      partnerType: partnerRow.type,
      partnerName: partnerRow.user.name,
      profitShare: { company: partnerRow.companyPercent, partner: partnerRow.partnerPercent },
      bank: {
        bankName: partnerRow.bankName,
        bankAccountName: partnerRow.bankAccountName,
        bankAccountNumber: partnerRow.bankAccountNumber,
      },
    });
  });
}
