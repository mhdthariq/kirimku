import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/topups/{id}/verify — Owner Company final verification (§10.1/§11):
 * VERIFIED + wallet credit happen ATOMICALLY in one DB transaction (§30).
 * Duplicate verification calls are idempotent via the unique businessRef —
 * the wallet is credited exactly once (§44).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.topup.verify");
    const { id } = await params;
    const topUp = await db.topUpRequest.findUnique({ where: { id: Number(id) } });
    if (!topUp) return fail(404, "Top up tidak ditemukan.");
    if (topUp.status === "VERIFIED") {
      return fail(422, "Top up ini sudah terverifikasi — wallet sudah dikredit.");
    }
    if (topUp.status !== "PENDING_VERIFICATION") {
      return fail(422, `Top up berstatus ${topUp.status} tidak bisa diverifikasi.`);
    }
    // The requesting partner can never verify their own top-up (§10.1) — an
    // Owner Company account has no partner profile, so this is defensive.
    if (user.partnerId && user.partnerId === topUp.partnerId) {
      return fail(403, "Akses ditolak — tidak boleh memverifikasi top up milik sendiri.");
    }

    const result = await db.$transaction(async (tx) => {
      const fresh = await tx.topUpRequest.findUniqueOrThrow({ where: { id: topUp.id } });
      if (fresh.status === "VERIFIED") {
        return { alreadyVerified: true as const, topUp: fresh };
      }
      const wallet = await tx.wallet.findUnique({ where: { partnerId: fresh.partnerId } });
      const walletId = wallet?.id ?? (await tx.wallet.create({ data: { partnerId: fresh.partnerId } })).id;
      const balanceBefore = wallet?.balance ?? 0;
      const balanceAfter = Math.round((balanceBefore + fresh.amount) * 100) / 100;

      // Unique business reference for this settlement (§9) — a duplicate
      // verification cannot create a second credit.
      let ledger: { id: number } | null = null;
      const existing = await tx.walletTransaction.findUnique({ where: { businessRef: `TOP-${fresh.id}` } });
      if (!existing) {
        ledger = await tx.walletTransaction.create({
          data: {
            walletId,
            type: "TOPUP",
            amount: fresh.amount,
            direction: "CREDIT",
            balanceBefore,
            balanceAfter,
            referenceType: "topup",
            referenceId: fresh.id,
            businessRef: `TOP-${fresh.id}`,
            status: "COMPLETED",
            description: `Top up ${fresh.requestCode} terverifikasi`,
            createdById: user.id,
          },
        });
        await tx.wallet.update({ where: { id: walletId }, data: { balance: balanceAfter } });
      } else {
        ledger = existing;
      }

      const updated = await tx.topUpRequest.update({
        where: { id: fresh.id },
        data: {
          status: "VERIFIED",
          verifiedById: user.id,
          verifiedAt: new Date(),
          walletTransactionId: ledger?.id ?? null,
        },
        include: { partner: { include: { user: { select: { name: true } } } } },
      });
      return { alreadyVerified: false as const, topUp: updated };
    });

    if (result.alreadyVerified) return ok(result.topUp);

    await financeAudit(user, "verified", "topup", topUp.id, topUp.requestCode, {
      status: "VERIFIED",
      amount: topUp.amount,
      creditedTo: result.topUp.partner.user.name,
    });
    return ok(result.topUp);
  });
}
