import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireNum, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";
import { nextCode } from "@/lib/code-generator";
import { COMPANY_BANK } from "@/lib/company";

const MIN_TOP_UP_AMOUNT = 10_000;
// data URL image/PDF proof — keep in sync with the repair proof limits
const MAX_PROOF_LENGTH = 12_000_000;

/**
 * Top Up workflow (simplified §10/§11) — Admin Kantor / Owner create a top-up
 * for a Marketing partner WITH the transfer proof attached at creation:
 *   Admin Kantor/Owner creates request + proof image → PENDING_VERIFICATION
 *   → Owner Company verifies → VERIFIED + atomic wallet credit
 *   (or rejection / cancellation while pending)
 *
 * Authority (§10.1): Marketing has NO top-up menu access — only Admin Kantor
 * (wallet.topup.create) and Owner can create; only wallet.topup.verify
 * (Owner) credits the wallet. There is no separate PENDING_PAYMENT stage.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    // Marketing sees only their own top-up history inside their wallet page
    // (§39 ownership isolation) — the Top Up menu itself is company-side only.
    if (user.partnerType === "MARKETING" && user.partnerId) {
      const rows = await db.topUpRequest.findMany({
        where: { partnerId: user.partnerId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        include: { verifiedBy: { select: { name: true } } },
      });
      return ok({ topUps: rows, bankInfo: COMPANY_BANK });
    }

    // Company-side management requires wallet.topup.view (Admin Kantor / Owner).
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

/** POST /api/v1/topups — Admin Kantor / Owner create a top-up request (with proof) for a Marketing partner. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.create");
    const body = await req.json().catch(() => ({}));
    const partnerId = requireNum(body.partnerId, "partnerId", 1);
    const partner = await db.partner.findFirst({ where: { id: partnerId, type: "MARKETING", isActive: true } });
    if (!partner) return fail(422, "Partner Marketing aktif wajib dipilih.", { partnerId: ["Partner Marketing tidak ditemukan atau tidak aktif."] });
    const amount = requireNum(body.amount, "amount", MIN_TOP_UP_AMOUNT);
    const note = str(body.note);
    const proofUrl = str(body.proofUrl);
    if (!proofUrl || !proofUrl.startsWith("data:")) {
      return fail(422, "Bukti transfer wajib dilampirkan.", { proofUrl: ["Bukti transfer (gambar/PDF) wajib diunggah."] });
    }
    if (proofUrl.length > MAX_PROOF_LENGTH) {
      return fail(422, "Ukuran bukti terlalu besar (maksimal 8 MB).", { proofUrl: ["Ukuran file maksimal 8 MB."] });
    }

    const requestCode = await nextCode("topUpRequest", "TOP-", "requestCode");
    const topUp = await db.topUpRequest.create({
      data: {
        requestCode,
        partnerId: partner.id,
        amount,
        status: "PENDING_VERIFICATION",
        partnerNote: note,
        proofUrl,
        requestedById: user.id,
        submittedForVerificationAt: new Date(),
      },
    });
    await financeAudit(user, "created", "topup", topUp.id, requestCode, { amount, status: "PENDING_VERIFICATION", proofAttached: true });
    return ok({ topUp, bankInfo: COMPANY_BANK });
  });
}
