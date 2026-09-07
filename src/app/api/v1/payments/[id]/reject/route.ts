import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "payment.verify");
    const { id } = await params;
    const payment = await db.payment.findUnique({ where: { id: Number(id) }, include: { master: true } });
    if (!payment) return fail(404, "Payment tidak ditemukan.");
    if (payment.status !== "RECORDED") return fail(422, `Payment berstatus ${payment.status}, hanya RECORDED yang bisa ditolak.`);

    const body = await req.json().catch(() => ({}));
    const reason = str(body.reason);
    const updated = await db.payment.update({
      where: { id: payment.id },
      data: { status: "REJECTED", verifiedById: user.id, verifiedAt: new Date() },
    });
    await audit({
      action: "status_change", entityType: "payment", entityId: payment.id,
      entityLabel: `${payment.master.masterCode} → REJECTED`, actor: user, after: { reason },
    });
    return ok(updated);
  });
}
