import { NextRequest } from "next/server";
import { guard, ok, handle } from "@/composition/api-helpers";
import { requirePartner, getOrCreateWallet } from "@/infrastructure/services/wallet";
import { db } from "@/infrastructure/persistence/db";

/**
 * GET /api/v1/wallet/transactions — own wallet ledger history (§24/§28).
 * Ownership isolation: a partner only ever receives their own ledger rows.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "wallet.transaction.view_own");
    const partner = requirePartner(user);
    const wallet = await getOrCreateWallet(partner.id);
    const params = req.nextUrl.searchParams;
    const type = params.get("type");
    const direction = params.get("direction");
    const transactions = await db.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        ...(type ? { type } : {}),
        ...(direction ? { direction } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok(transactions);
  });
}
