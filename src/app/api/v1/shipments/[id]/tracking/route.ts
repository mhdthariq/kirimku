import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.view_tracking");
    const { id } = await params;
    const shipment = await db.masterShipment.findUnique({ where: { id: Number(id) } });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, shipment);
    const events = await db.trackingEvent.findMany({
      where: { masterId: Number(id) },
      orderBy: { occurredAt: "desc" },
      include: { actor: true },
    });
    return ok(events);
  });
}
