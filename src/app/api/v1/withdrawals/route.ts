import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireNum, str } from "@/lib/api-helpers";
import { requirePartner, assertAvailableBalance, financeAudit } from "@/lib/wallet";
import { nextCode } from "@/lib/code-generator";

/**
 * Partner withdrawals (§23–§27) — Marketing AND Vehicle Owner can request
 * withdrawals of their OWN available balance. Creating a request reserves
 * the amount (available = balance − reserved) so the same funds cannot be
 * requested twice concurrently.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const status = str(params.get("status"));

    // Partners see only their own withdrawals (§24/§39).
    if (user.partnerId && (user.partnerType === "MARKETING" || user.partnerType === "VEHICLE_OWNER")) {
      const rows = await db.withdrawalRequest.findMany({
        where: { partnerId: user.partnerId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        include: { reviewedBy: { select: { name: true } }, processedBy: { select: { name: true } } },
      });
      return ok(rows);
    }

    // Company-side management (Admin Kantor / Owner Company — §25).
    if (!user.isOwner && !user.permissions.includes("wallet.withdrawal.view")) {
      return fail(403, "Missing permission: wallet.withdrawal.view");
    }
    const partnerType = str(params.get("partnerType"));
    const rows = await db.withdrawalRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(partnerType ? { partner: { type: partnerType } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        partner: { include: { user: { select: { name: true, username: true } } } },
        reviewedBy: { select: { name: true } },
        processedBy: { select: { name: true } },
      },
    });
    return ok(rows);
  });
}

/**
 * POST /api/v1/withdrawals — partner creates a withdrawal request (§26).
 * The amount is validated against the AVAILABLE balance (balance − reserved)
 * and becomes reserved while the request is in flight (§27).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.create");
    const partner = requirePartner(user);
    const body = await req.json().catch(() => ({}));
    const amount = requireNum(body.amount, "amount", 1);
    const note = str(body.note);

    const partnerRow = await db.partner.findUniqueOrThrow({ where: { id: partner.id } });
    // Registered bank account required (§24: "Select/use their registered
    // bank account") — snapshot onto the request.
    if (!partnerRow.bankAccountNumber || !partnerRow.bankAccountName) {
      return fail(422, "Lengkapi rekening bank terdaftar di Profil sebelum melakukan withdrawal.", {
        bankAccountNumber: ["Rekening bank wajib terdaftar."],
      });
    }

    await assertAvailableBalance(partner.id, amount);

    const requestCode = await nextCode("withdrawalRequest", "WDR-", "requestCode");
    const withdrawal = await db.withdrawalRequest.create({
      data: {
        requestCode,
        partnerId: partner.id,
        amount,
        status: "PENDING",
        bankName: partnerRow.bankName,
        bankAccountName: partnerRow.bankAccountName,
        bankAccountNumber: partnerRow.bankAccountNumber,
        partnerNote: note,
        requestedById: user.id,
      },
    });
    await financeAudit(user, "created", "withdrawal", withdrawal.id, requestCode, { amount, status: "PENDING" });
    return ok(withdrawal);
  });
}
