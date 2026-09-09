import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { paymentSummary } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Gudang → marketing notification about an unpaid shipment sitting at the
 * gudang (dp/balance still open). Creates a tracking event + audit entry so
 * marketing can follow up whether the customer still wants the delivery.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.notify_marketing");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");

    const summary = await paymentSummary(master.id);
    if (summary.remainingAmount <= 0) {
      return fail(422, "Shipment ini sudah lunas — tidak perlu notifikasi.");
    }

    const body = await req.json().catch(() => ({}));
    const note = str(body.note) ?? "Mohon follow-up ke customer apakah kiriman tetap diproses.";

    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "GUDANG_NOTIFY_MARKETING",
        description: `Gudang memberi tahu marketing: sisa pembayaran Rp${Math.round(summary.remainingAmount).toLocaleString("id-ID")} — ${note}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "notified_marketing",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} · sisa Rp${Math.round(summary.remainingAmount)}`,
      actor: user,
      after: { note },
    });
    return ok({ notified: true, remainingAmount: summary.remainingAmount });
  });
}
