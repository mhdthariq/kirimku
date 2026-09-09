import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { resolveTariff, computePricing } from "@/lib/pricing";
import { hasPermission } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * Compute and snapshot pricing for a shipment from its tariff.
 * Formula: volumetric kg = (L × W × H cm / 1.000.000) × multiplier (kg/m³,
 * configurable per tariff). Chargeable = max(actual, volumetric), floored at
 * minChargeableKg, rounded per tariff rounding settings.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    // allowed: shipment editors, or staff who may initiate a pickup request
    if (!hasPermission(user, "shipment.update") && !hasPermission(user, "pickup.create")) {
      return fail(403, "Missing permission: shipment.update");
    }
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: { customer: true, details: true },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (!["CREATED", "READY_FOR_PICKUP", "PICKED_UP"].includes(master.status)) {
      return fail(422, "Harga hanya bisa dihitung sebelum shipment masuk gudang.");
    }

    const body = await req.json().catch(() => ({}));
    const overrideTariffId = num(body.tariffId);

    const tariff = overrideTariffId
      ? await db.tariff.findFirst({
          where: {
            id: overrideTariffId,
            isActive: true,
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
          },
        })
      : await resolveTariff(master);

    if (!tariff) {
      return fail(422, `Tidak ada tarif aktif untuk ${master.origin} → ${master.destination} (${master.customer.type}).`);
    }

    const r = computePricing(master.details, tariff);
    // persist the tariff used so the snapshot (and future re-calcs) is deterministic
    const updated = await db.masterShipment.update({
      where: { id: master.id },
      data: {
        tariffId: tariff.id,
        chargeableWeightKg: r.chargeableKg,
        ratePerKg: tariff.ratePerKg,
        priceAmount: r.price,
        pricedAt: new Date(),
      },
    });

    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "PRICED",
        description: `Harga dihitung: chargeable ${r.chargeableKg.toFixed(1)} kg (aktual ${r.actualKg.toFixed(1)} kg, volumetrik ${r.volumetricKg.toFixed(2)} kg = L×W×H/1.000.000 × ${r.multiplier}) × Rp${tariff.ratePerKg.toLocaleString("id-ID")} = Rp${r.price.toLocaleString("id-ID")}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "priced", entityType: "shipment", entityId: master.id, entityLabel: master.masterCode, actor: user,
      after: { chargeableWeightKg: r.chargeableKg, ratePerKg: tariff.ratePerKg, priceAmount: r.price, volumetricMultiplier: r.multiplier },
    });
    return ok({ ...updated, pricing: r });
  });
}
