import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/withdrawals/{id}/complete — company completes the withdrawal
 * after the bank transfer with proof (§26): status → COMPLETED and the wallet
 * debit happen ATOMICALLY in one DB transaction (§30). The unique businessRef
 * `WDR-{id}` guarantees the ledger entry is created exactly once — duplicate
 * completes cannot double-debit (§44).
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "wallet.withdrawal.process");
    const { id } = await params;
    const withdrawal = await db.withdrawalRequest.findUnique({ where: { id: Number(id) } });
    if (!withdrawal) return fail(404, "Permintaan withdrawal tidak ditemukan.");
    if (withdrawal.status === "COMPLETED") {
      return fail(422, "Withdrawal ini sudah selesai — tidak bisa diselesaikan dua kali.");
    }
    if (withdrawal.status !== "PROCESSING" && withdrawal.status !== "APPROVED") {
      return fail(422, `Withdrawal berstatus ${withdrawal.status} tidak bisa diselesaikan.`);
    }

    const body = await req.json().catch(() => ({}));
    const proofUrl = str(body.proofUrl);

    const result = await db.$transaction(async (tx) => {
      const fresh = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id: withdrawal.id } });
      if (fresh.status === "COMPLETED") {
        return { alreadyCompleted: true as const, withdrawal: fresh };
      }

      // Exactly-once ledger debit for this withdrawal (§9/§43).
      let ledgerId: number | null = fresh.walletTransactionId;
      const existing = await tx.walletTransaction.findUnique({ where: { businessRef: `WDR-${fresh.id}` } });
      if (!existing) {
        const wallet = await tx.wallet.findUnique({ where: { partnerId: fresh.partnerId } });
        if (!wallet) throw new Error("wallet missing");
        const balanceBefore = wallet.balance;
        const balanceAfter = Math.round((balanceBefore - fresh.amount) * 100) / 100;
        if (balanceAfter < -0.001) {
          throw new Error("Saldo wallet tidak mencukupi untuk menyelesaikan withdrawal ini.");
        }
        const ledger = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "WITHDRAWAL",
            amount: fresh.amount,
            direction: "DEBIT",
            balanceBefore,
            balanceAfter,
            referenceType: "withdrawal",
            referenceId: fresh.id,
            businessRef: `WDR-${fresh.id}`,
            status: "COMPLETED",
            description: `Withdrawal ${fresh.requestCode} ke ${fresh.bankAccountName ?? "-"} (${fresh.bankName ?? "-"})`,
            createdById: user.id,
          },
        });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        ledgerId = ledger.id;
      } else {
        ledgerId = existing.id;
      }

      const updated = await tx.withdrawalRequest.update({
        where: { id: fresh.id },
        data: {
          status: "COMPLETED",
          processedById: user.id,
          processedAt: fresh.processedAt ?? new Date(),
          completedAt: new Date(),
          walletTransactionId: ledgerId,
          ...(proofUrl ? { transferProofUrl: proofUrl } : {}),
        },
        include: { partner: { include: { user: { select: { name: true } } } } },
      });
      return { alreadyCompleted: false as const, withdrawal: updated };
    });

    if (result.alreadyCompleted) return ok(result.withdrawal);

    await financeAudit(user, "completed", "withdrawal", withdrawal.id, withdrawal.requestCode, {
      amount: withdrawal.amount,
      partner: result.withdrawal.partner.user.name,
    });
    return ok(result.withdrawal);
  });
}
