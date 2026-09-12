import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode, nextDetailCodes } from "@/lib/code-generator";
import { hasPermission } from "@/lib/auth";
import { totalsByMaster } from "@/lib/shipment-totals";
import { cityIndex, inScope, shipmentGudangIds, scopeForUser } from "@/lib/gudang-scope";

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
        invoiceLines: { select: { invoice: { select: { id: true, invoiceNumber: true, status: true } } } },
        _count: { select: { details: true, pickups: true, deliveries: true, payments: true } },
        ...(hasPermission(user, "shipment.view_tracking") ? { trackingEvents: { orderBy: { occurredAt: "desc" as const }, take: 1 } } : {}),
      },
    });

    // Gudang data separation: non-owner users only see shipments that belong
    // to their own gudang; each row carries gudangIds so the owner's
    // per-gudang tabs can filter client-side.
    const scope = await scopeForUser(user);
    const cityIdx = await cityIndex();
    const visible = shipments.filter((s) => inScope(shipmentGudangIds(s, cityIdx), scope));

    // Physical totals (volume m³ + weight kg) for the list columns
    const totals = await totalsByMaster(visible.map((s) => s.id));
    return ok(
      visible.map((s) => ({
        ...s,
        gudangIds: shipmentGudangIds(s, cityIdx),
        totals: totals.get(s.id) ?? { totalPackages: 0, totalActualKg: 0, totalVolumeM3: 0 },
      })),
    );
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

    // Revise.md §6 — Marketing enters the discount as an AMOUNT in Rupiah.
    // The percentage is always derived by the system, never typed manually.
    const discountAmount = Math.max(0, num(body.discountAmount) ?? 0);

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

    // Revise.md — attribute the shipment to the Marketing partner that
    // created it (drives B2B commission + discount validation). Non-partner
    // users (owner/admin) create unattributed shipments.
    const createdByPartnerId = user.partnerType === "MARKETING" && user.partnerId ? user.partnerId : null;

    // Optional inline details — quantity N expands into N package rows with unique codes
    const details = Array.isArray(body.details) ? body.details : [];
    if (details.length > 100) {
      return fail(422, "Maksimal 100 baris detail per shipment.");
    }
    for (const d of details) {
      const qty = Math.round(num(d.quantity) ?? 1);
      if (!Number.isFinite(qty) || qty < 1 || qty > 500) {
        return fail(422, "Jumlah paket setiap detail harus antara 1–500.", { quantity: ["Jumlah paket harus antara 1–500."] });
      }
    }

    const shipment = await db.$transaction(async (tx) => {
      const created = await tx.masterShipment.create({
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
          penerimaName: str(body.penerimaName),
          penerimaAddress: str(body.penerimaAddress),
          penerimaContact: str(body.penerimaContact),
          discountAmount,
          createdByPartnerId,
        },
      });

      // Optional inline details — quantity N expands into N package rows with unique codes
      for (const d of details) {
        const description = str(d.description);
        if (!description) continue;
        const qty = Math.round(num(d.quantity) ?? 1);
        const codes = await nextDetailCodes(created.id, masterCode, qty);
        await tx.detailShipment.createMany({
          data: codes.map((detailCode) => ({
            detailCode,
            masterId: created.id,
            description,
            lengthCm: num(d.lengthCm),
            widthCm: num(d.widthCm),
            heightCm: num(d.heightCm),
            actualWeightKg: num(d.actualWeightKg) ?? 0,
          })),
        });
      }

      await tx.trackingEvent.create({
        data: {
          masterId: created.id,
          event: "CREATED",
          description: `Shipment ${masterCode} dibuat oleh ${user.name}`,
          actorId: user.id,
        },
      });
      return created;
    });
    await audit({ action: "created", entityType: "shipment", entityId: shipment.id, entityLabel: masterCode, actor: user, after: shipment });
    const full = await db.masterShipment.findUnique({ where: { id: shipment.id }, include: { customer: true, details: true } });
    return ok(full);
  });
}
