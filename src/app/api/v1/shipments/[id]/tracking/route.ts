import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    await guard(req, "shipment.view_tracking");
    const { id } = await params;
    const events = await db.trackingEvent.findMany({
      where: { masterId: Number(id) },
      orderBy: { occurredAt: "desc" },
      include: { actor: true },
    });
    if (events.length === 0) {
      const shipment = await db.masterShipment.findUnique({ where: { id: Number(id) } });
      if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    }
    return ok(events);
  });
}
