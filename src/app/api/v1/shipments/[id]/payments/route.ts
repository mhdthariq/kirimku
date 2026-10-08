import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, requireStr, requireNum, str } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { checkNoOverpayment } from "@/infrastructure/services/business-rules/payment";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "payment.view");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    const payments = await db.payment.findMany({
      where: { masterId: Number(id) },
      orderBy: { createdAt: "desc" },
      include: { recordedBy: true, verifiedBy: true },
    });
    return ok(payments);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "payment.record");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!master.priceAmount) return fail(422, "Hitung harga shipment terlebih dahulu sebelum mencatat pembayaran.");

    const body = await req.json().catch(() => ({}));
    const method = body.method === "TRANSFER" ? "TRANSFER" : "CASH";
    const amount = requireNum(body.amount, "amount", 1);
    const reference = str(body.reference);

    // Business Rules (Roadmap Phase 8) — prevent overpayment: the recorded
    // amount must not exceed the outstanding balance (finalPrice − verified
    // payments). Re-checked inside the transaction below (TOCTOU guard).
    const overpayMsg = await checkNoOverpayment(master.id, amount);
    if (overpayMsg) return fail(422, overpayMsg);

    const payment = await db.$transaction(async (tx) => {
      // Re-validate outstanding inside the transaction to prevent a race
      // where another payment was verified between the check and the insert.
      const verifiedPayments = await tx.payment.findMany({
        where: { masterId: master.id, status: "VERIFIED" },
        select: { amount: true },
      });
      const finalPrice = master.finalPriceAmount ?? master.priceAmount ?? 0;
      const verifiedPaid = verifiedPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
      const outstanding = Math.max(0, finalPrice - verifiedPaid);
      if (amount > outstanding) {
        throw new Error(`OVERPAYMENT: Pembayaran (${amount.toLocaleString("id-ID")}) melebihi sisa tagihan (${outstanding.toLocaleString("id-ID")}).`);
      }
      return tx.payment.create({
        data: { masterId: master.id, method, amount, status: "RECORDED", reference, recordedById: user.id },
      });
    }).catch((e) => {
      if (e instanceof Error && e.message.startsWith("OVERPAYMENT:")) {
        return { __overpaymentError: e.message } as unknown as { __overpaymentError: string };
      }
      throw e;
    });
    if ("__overpaymentError" in payment) {
      return fail(422, payment.__overpaymentError);
    }

    await audit({ action: "created", entityType: "payment", entityId: payment.id, entityLabel: `${master.masterCode} · Rp${amount.toLocaleString("id-ID")}`, actor: user, after: payment });
    return ok(payment);
  });
}
