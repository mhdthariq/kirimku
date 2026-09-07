import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireNum, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** Record a settlement payment against a SENT invoice. */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "payment.verify");
    const { id } = await params;
    const invoice = await db.invoice.findUnique({ where: { id: Number(id) }, include: { lines: true, settlements: true } });
    if (!invoice) return fail(404, "Invoice tidak ditemukan.");
    if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
      return fail(422, `Invoice berstatus ${invoice.status} tidak bisa di-settle.`);
    }

    const body = await req.json().catch(() => ({}));
    const amount = requireNum(body.amount, "amount", 1);
    const method = body.method === "TRANSFER" ? "TRANSFER" : "CASH";
    const reference = str(body.reference);

    const total = invoice.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const settled = invoice.settlements.reduce((sum, s) => sum + s.amount, 0);
    const remaining = total - settled;
    if (amount > remaining + 0.01) {
      return fail(422, `Jumlah settlement (Rp${amount.toLocaleString("id-ID")}) melebihi sisa tagihan (Rp${remaining.toLocaleString("id-ID")}).`, {
        amount: ["Jumlah melebihi sisa tagihan."],
      });
    }

    const settlement = await db.invoiceSettlement.create({
      data: { invoiceId: invoice.id, amount, method, reference, recordedById: user.id },
    });
    const newSettled = settled + amount;
    const newStatus = newSettled >= total - 0.01 ? "SETTLED" : "PARTIALLY_SETTLED";
    const updated = await db.invoice.update({ where: { id: invoice.id }, data: { status: newStatus } });
    await audit({
      action: "settled", entityType: "invoice", entityId: invoice.id,
      entityLabel: `${invoice.invoiceNumber} · Rp${amount.toLocaleString("id-ID")}`, actor: user, after: { status: newStatus },
    });
    return ok({ settlement, invoice: updated });
  });
}
