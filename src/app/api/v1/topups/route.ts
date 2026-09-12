import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireNum, str } from "@/lib/api-helpers";
import { requirePartner, financeAudit } from "@/lib/wallet";
import { nextCode } from "@/lib/code-generator";
import { COMPANY_BANK } from "@/lib/company";

const MIN_TOP_UP_AMOUNT = 10_000;

/**
 * Top Up workflow (§10/§11) — Marketing wallet deposits:
 *   Marketing creates request (PENDING_PAYMENT)
 *   → transfers to the company bank account
 *   → submits transfer info/proof (partnerProofUrl)
 *   → Admin Kantor uploads official proof → PENDING_VERIFICATION
 *   → Owner Company verifies → VERIFIED + atomic wallet credit
 *
 * Authority (§10.1): Marketing can never verify/credit own top-up;
 * Admin Kantor cannot finalize; only wallet.topup.verify (Owner) credits.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    // Marketing sees only their own top-ups (§39 ownership isolation).
    if (user.partnerType === "MARKETING" && user.partnerId) {
      const rows = await db.topUpRequest.findMany({
        where: { partnerId: user.partnerId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        include: { verifiedBy: { select: { name: true } } },
      });
      return ok({ topUps: rows, bankInfo: COMPANY_BANK });
    }

    // Company-side management requires wallet.topup.view.
    if (!user.isOwner && !user.permissions.includes("wallet.topup.view")) {
      return fail(403, "Missing permission: wallet.topup.view");
    }
    const partnerType = str(params.get("partnerType"));
    const rows = await db.topUpRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(partnerType ? { partner: { type: partnerType } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        partner: { include: { user: { select: { name: true, username: true } } } },
        verifiedBy: { select: { name: true } },
      },
    });
    return ok({ topUps: rows, bankInfo: COMPANY_BANK });
  });
}

/** POST /api/v1/topups — Marketing creates a top-up request. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.create");
    const partner = requirePartner(user, "MARKETING");
    const body = await req.json().catch(() => ({}));
    const amount = requireNum(body.amount, "amount", MIN_TOP_UP_AMOUNT);
    const note = str(body.note);

    const requestCode = await nextCode("topUpRequest", "TOP-", "requestCode");
    const topUp = await db.topUpRequest.create({
      data: {
        requestCode,
        partnerId: partner.id,
        amount,
        status: "PENDING_PAYMENT",
        partnerNote: note,
        requestedById: user.id,
      },
    });
    await financeAudit(user, "created", "topup", topUp.id, requestCode, { amount, status: "PENDING_PAYMENT" });
    return ok({ topUp, bankInfo: COMPANY_BANK });
  });
}
