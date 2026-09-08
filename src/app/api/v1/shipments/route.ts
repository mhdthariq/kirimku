import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode, nextDetailCodes } from "@/lib/code-generator";
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
                { masterCode: { contains: search } },
                { origin: { contains: search } },
                { destination: { contains: search } },
                { customer: { name: { contains: search } } },
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

    // Route comes from the tariff dropdown (Kota Asal/Tujuan no longer typed by hand).
    // Legacy clients may still send origin/destination directly.
    const tariffId = num(body.tariffId);
    let origin: string | null = null;
    let destination: string | null = null;
    let tariff: { id: number; origin: string; destination: string; customerType: string | null } | null = null;

    if (tariffId) {
      const now = new Date();
      tariff = await db.tariff.findFirst({
        where: {
          id: tariffId,
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
      });
      if (!tariff) return fail(422, "Tarif tidak ditemukan / tidak aktif.", { tariffId: ["Tarif tidak ditemukan / tidak aktif."] });
      if (tariff.customerType && tariff.customerType !== customer.type) {
        return fail(422, `Tarif ini hanya untuk customer ${tariff.customerType.toUpperCase()} — customer terpilih bertipe ${customer.type.toUpperCase()}.`, {
          tariffId: [`Tarif ${tariff.customerType.toUpperCase()} tidak cocok untuk customer ${customer.type.toUpperCase()}.`],
        });
      }
      origin = tariff.origin;
      destination = tariff.destination;
    } else {
      origin = typeof body.origin === "string" && body.origin.trim() ? body.origin.trim() : null;
      destination = typeof body.destination === "string" && body.destination.trim() ? body.destination.trim() : null;
    }
    if (!origin || !destination) {
      return fail(422, "Rute wajib dipilih dari daftar tarif.", { tariffId: ["Rute wajib dipilih dari daftar tarif."] });
    }

    const masterCode = await nextCode("masterShipment", "MKT-", "masterCode", 7);

    const originWarehouseId = num(body.originWarehouseId);
    const destinationWarehouseId = num(body.destinationWarehouseId);

    const shipment = await db.masterShipment.create({
      data: {
        masterCode,
        resi: masterCode,
        customerId,
        tariffId: tariff?.id ?? null,
        status: "CREATED",
        origin,
        destination,
        originWarehouseId: originWarehouseId ?? null,
        destinationWarehouseId: destinationWarehouseId ?? null,
      },
    });

    // Optional inline details — quantity N expands into N package rows with unique codes
    const details = Array.isArray(body.details) ? body.details : [];
    for (const d of details) {
      const description = str(d.description);
      if (!description) continue;
      const qty = Math.max(1, Math.round(num(d.quantity) ?? 1));
      const codes = await nextDetailCodes(shipment.id, masterCode, qty);
      await db.detailShipment.createMany({
        data: codes.map((detailCode) => ({
          detailCode,
          masterId: shipment.id,
          description,
          lengthCm: num(d.lengthCm),
          widthCm: num(d.widthCm),
          heightCm: num(d.heightCm),
          actualWeightKg: num(d.actualWeightKg) ?? 0,
        })),
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
