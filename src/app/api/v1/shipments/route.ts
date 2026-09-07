import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, num, ci } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode, nextDetailCode } from "@/lib/code-generator";
import { hasPermission } from "@/lib/auth";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const status = str(params.get("status"));
    const customerType = str(params.get("customerType"));

    const shipments = await db.masterShipment.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(customerType ? { customer: { type: customerType } } : {}),
        ...(search
          ? {
              OR: [
                { masterCode: ci(search) },
                { origin: ci(search) },
                { destination: ci(search) },
                { customer: { name: ci(search) } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: true,
        _count: { select: { details: true, pickups: true, deliveries: true, payments: true } },
        ...(hasPermission(user, "shipment.view_tracking") ? { trackingEvents: { orderBy: { occurredAt: "desc" as const }, take: 1 } } : {}),
      },
    });
    return ok(shipments);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "shipment.create");
    const body = await req.json().catch(() => ({}));
    const customerId = num(body.customerId);
    if (!customerId) return fail(422, "Customer wajib dipilih.", { customerId: ["Customer wajib dipilih."] });
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) return fail(422, "Customer tidak ditemukan.", { customerId: ["Customer tidak ditemukan."] });

    const origin = requireStr(body.origin, "origin");
    const destination = requireStr(body.destination, "destination");

    const masterCode = await nextCode("masterShipment", "MKT-", "masterCode", 7);

    const originWarehouseId = num(body.originWarehouseId);
    const destinationWarehouseId = num(body.destinationWarehouseId);

    const shipment = await db.masterShipment.create({
      data: {
        masterCode,
        resi: masterCode,
        customerId,
        status: "CREATED",
        origin,
        destination,
        originWarehouseId: originWarehouseId ?? null,
        destinationWarehouseId: destinationWarehouseId ?? null,
      },
    });

    // Optional inline details
    const details = Array.isArray(body.details) ? body.details : [];
    for (const d of details) {
      const description = str(d.description);
      if (!description) continue;
      await db.detailShipment.create({
        data: {
          detailCode: await nextDetailCode(shipment.id, masterCode),
          masterId: shipment.id,
          description,
          quantity: Math.max(1, Math.round(num(d.quantity) ?? 1)),
          lengthCm: num(d.lengthCm),
          widthCm: num(d.widthCm),
          heightCm: num(d.heightCm),
          actualWeightKg: num(d.actualWeightKg) ?? 0,
        },
      });
    }

    await db.trackingEvent.create({
      data: {
        masterId: shipment.id,
        event: "CREATED",
        description: `Shipment ${masterCode} dibuat oleh ${user.name}`,
        actorId: user.id,
      },
    });
    await audit({ action: "created", entityType: "shipment", entityId: shipment.id, entityLabel: masterCode, actor: user, after: shipment });
    const full = await db.masterShipment.findUnique({ where: { id: shipment.id }, include: { customer: true, details: true } });
    return ok(full);
  });
}
