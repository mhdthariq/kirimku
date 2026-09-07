import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * Compute and snapshot pricing for a shipment from the active tariff.
 * Chargeable weight = max(actual weight, volumetric weight) with configurable
 * divisor + rounding, bounded below by minChargeableKg.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.update");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) }, include: { customer: true, details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    if (!["CREATED", "READY_FOR_PICKUP", "PICKED_UP"].includes(master.status)) {
      return fail(422, "Harga hanya bisa dihitung sebelum shipment masuk gudang.");
    }

    const body = await req.json().catch(() => ({}));
    const overrideTariffId = num(body.tariffId);

    const actualWeight = master.details.reduce((sum, d) => sum + (d.actualWeightKg || 0) * (d.quantity || 1), 0);
    const volumetricWeight = master.details.reduce((sum, d) => {
      const l = d.lengthCm ?? 0;
      const w = d.widthCm ?? 0;
      const h = d.heightCm ?? 0;
      return sum + (l * w * h * (d.quantity || 1));
    }, 0);

    const tariff = overrideTariffId
      ? await db.tariff.findUnique({ where: { id: overrideTariffId } })
      : await db.tariff.findFirst({
          where: {
            origin: master.origin,
            destination: master.destination,
            isActive: true,
            OR: [{ customerType: master.customer.type }, { customerType: null }],
          },
          orderBy: [{ customerType: "desc" }, { effectiveFrom: "desc" }],
        });

    if (!tariff) return fail(422, `Tidak ada tarif aktif untuk ${master.origin} → ${master.destination} (${master.customer.type}).`);

    const volumetric = tariff.volumetricDivisor > 0 ? volumetricWeight / tariff.volumetricDivisor : 0;
    let chargeable = Math.max(actualWeight, volumetric);
    chargeable = Math.max(chargeable, tariff.minChargeableKg);
    if (tariff.roundingUnitKg > 0) {
      chargeable =
        tariff.roundingMode === "NEAREST"
          ? Math.round(chargeable / tariff.roundingUnitKg) * tariff.roundingUnitKg
          : Math.ceil(chargeable / tariff.roundingUnitKg) * tariff.roundingUnitKg;
    }
    const price = Math.round(chargeable * tariff.ratePerKg);

    const updated = await db.masterShipment.update({
      where: { id: master.id },
      data: {
        chargeableWeightKg: chargeable,
        ratePerKg: tariff.ratePerKg,
        priceAmount: price,
        pricedAt: new Date(),
      },
    });

    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "PRICED",
        description: `Harga dihitung: ${chargeable.toFixed(1)} kg × Rp${tariff.ratePerKg.toLocaleString("id-ID")} = Rp${price.toLocaleString("id-ID")}`,
        actorId: user.id,
      },
    });
    await audit({
      action: "priced", entityType: "shipment", entityId: master.id, entityLabel: master.masterCode, actor: user,
      after: { chargeableWeightKg: chargeable, ratePerKg: tariff.ratePerKg, priceAmount: price },
    });
    return ok(updated);
  });
}
