import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { financeAudit } from "@/lib/wallet";
import { nextCode } from "@/lib/code-generator";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/transports/{id}/settle — finalize the Vehicle Owner transport
 * settlement (§14/§15/§30): create the settlement record (snapshotting the
 * value + percentages used at this moment — §37 historical preservation) AND
 * credit the Vehicle Owner wallet with TRANSPORT_PROFIT_SHARE atomically.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "transport.settle");
    const { id } = await params;
    const transport = await db.transport.findUnique({
      where: { id: Number(id) },
      include: {
        vehicle: { include: { owner: { include: { user: { select: { name: true } } } } } },
        route: true,
        shipments: { include: { master: { select: { priceAmount: true } } } },
      },
    });
    if (!transport) return fail(404, "Transport tidak ditemukan.");

    const existing = await db.transportSettlement.findUnique({ where: { transportId: transport.id } });
    if (existing) return fail(422, `Transport ini sudah disettle (${existing.settlementCode}).`);

    if (transport.status !== "ARRIVED") {
      return fail(422, `Transport berstatus ${transport.status} belum bisa disettle — harus ARRIVED.`);
    }
    if (!transport.vehicle.owner) {
      return fail(422, "Kendaraan ini milik perusahaan (bukan Vehicle Owner) — tidak ada profit share yang perlu dibayarkan.");
    }

    // Transport value: company input, defaulting to the aggregate price of the
    // loaded shipments (§15 — "clearly defined financial value").
    const body = await req.json().catch(() => ({}));
    const shipmentsPrice = transport.shipments.reduce(
      (sum, ts) => sum + (ts.master.priceAmount ?? 0),
      0,
    );
    const transportValue = num(body.transportValue) ?? shipmentsPrice;
    if (transportValue <= 0) {
      return fail(422, "Nilai transport harus lebih besar dari nol — shipment yang dimuat belum diharga dan tidak ada nilai yang diinput.", {
        transportValue: ["Nilai transport wajib diisi."],
      });
    }

    const owner = transport.vehicle.owner;
    const companyAmount = Math.round(transportValue * (owner.companyPercent / 100) * 100) / 100;
    const ownerAmount = Math.round(transportValue * (owner.partnerPercent / 100) * 100) / 100;

    const settlementCode = await nextCode("transportSettlement", "TST-", "settlementCode");
    const businessRef = `TST-TRP-${transport.id}`;

    const result = await db.$transaction(async (tx) => {
      // Exactly-once guard: a settlement row or ledger entry for this
      // transport can only exist once (unique constraints).
      const dupe = await tx.transportSettlement.findUnique({ where: { transportId: transport.id } });
      if (dupe) throw new Error("ALREADY_SETTLED");

      // Ledger debit/credit inside the same transaction (§30 atomicity).
      let ledgerId: number | null = null;
      const existingLedger = await tx.walletTransaction.findUnique({ where: { businessRef } });
      if (!existingLedger) {
        let wallet = await tx.wallet.findUnique({ where: { partnerId: owner.id } });
        if (!wallet) wallet = await tx.wallet.create({ data: { partnerId: owner.id } });
        const balanceBefore = wallet.balance;
        const balanceAfter = Math.round((balanceBefore + ownerAmount) * 100) / 100;
        const ledger = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "TRANSPORT_PROFIT_SHARE",
            amount: ownerAmount,
            direction: "CREDIT",
            balanceBefore,
            balanceAfter,
            referenceType: "transport_settlement",
            referenceId: transport.id,
            businessRef,
            status: "COMPLETED",
            description: `Profit share transport ${transport.transportCode} (${owner.ownerPercent}% dari Rp${transportValue.toLocaleString("id-ID")})`,
            createdById: user.id,
          },
        });
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        ledgerId = ledger.id;
      } else {
        ledgerId = existingLedger.id;
      }

      const settlement = await tx.transportSettlement.create({
        data: {
          settlementCode,
          transportId: transport.id,
          vehicleId: transport.vehicleId,
          ownerId: owner.id,
          transportValue,
          companyPercent: owner.companyPercent,
          ownerPercent: owner.partnerPercent,
          companyAmount,
          ownerAmount,
          status: "FINALIZED",
          finalizedById: user.id,
          finalizedAt: new Date(),
          walletTransactionId: ledgerId,
        },
        include: {
          transport: { select: { transportCode: true } },
          vehicle: { select: { vehicleNumber: true } },
          owner: { include: { user: { select: { name: true } } } },
        },
      });
      return settlement;
    });

    await financeAudit(user, "settled", "transport_settlement", result.id, settlementCode, {
      transportCode: transport.transportCode,
      transportValue,
      ownerPercent: owner.partnerPercent,
      ownerAmount,
      owner: owner.user.name,
    });
    return ok(result);
  });
}
