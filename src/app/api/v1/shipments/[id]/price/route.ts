import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { resolveTariff, computePricing } from "@/lib/pricing";
import { hasPermission } from "@/lib/auth";
import { assertShipmentScope } from "@/lib/gudang-scope";
import { walletSummary } from "@/lib/wallet";

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
    await assertShipmentScope(user, master);
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

    // Marketing discounts are absorbed by the partner share; company-funded
    // discounts reduce company profit. Both must remain below the original price.
    let discountAmount = num(body.discountAmount) ?? master.discountAmount ?? 0;
    if (discountAmount < 0) discountAmount = 0;
    const partner = master.createdByPartnerId
      ? await db.partner.findUnique({ where: { id: master.createdByPartnerId } })
      : null;
    if (discountAmount > 0) {
      if (discountAmount >= r.price) {
        return fail(422, `Discount (Rp${discountAmount.toLocaleString("id-ID")}) harus lebih kecil dari harga shipment (Rp${r.price.toLocaleString("id-ID")}).`, {
          discountAmount: ["Discount melebihi harga shipment."],
        });
      }
      if ((master.discountFundedBy === "MARKETING" || master.createdByPartnerId != null) && partner) {
        const partnerShare = (r.price * partner.partnerPercent) / 100;
        if (discountAmount > partnerShare + 0.001) {
          return fail(
            422,
            `Discount Rp${discountAmount.toLocaleString("id-ID")} melebihi bagian Marketing (Rp${Math.round(partnerShare).toLocaleString("id-ID")} = ${partner.partnerPercent}% dari harga) — discount akan membuat bagian Marketing negatif (§6.2).`,
            { discountAmount: ["Discount melebihi bagian Marketing."] },
          );
        }
      }
    }
    // Auto-derived percentage (§6): discount% = discountAmount / price × 100
    const discountPercentage = discountAmount > 0 ? Math.round((discountAmount / r.price) * 10000) / 100 : null;
    const finalPriceAmount = Math.round((r.price - discountAmount) * 100) / 100;

    // Marketing wallet coverage rule — when a Marketing partner opens (prices)
    // a shipment, their wallet must hold at least the COMPANY's share of the
    // shipment total, derived from the partner's profit-sharing configuration.
    // Example: 80:20 split (company 80% / marketing 20%), total Rp100.000 →
    // marketing must have ≥ Rp80.000 available in their wallet. The available
    // balance already deducts in-flight withdrawal reservations (§27).
    if ((master.discountFundedBy === "MARKETING" || master.createdByPartnerId != null) && partner) {
      const companyShare = Math.round(finalPriceAmount * (partner.companyPercent / 100) * 100) / 100;
      if (companyShare > 0) {
        const summary = await walletSummary(partner.id);
        if (summary.available < companyShare - 0.001) {
          return fail(
            422,
            `Saldo wallet Marketing tidak mencukupi untuk membuka shipment ini. ` +
              `Diperlukan minimal Rp${Math.round(companyShare).toLocaleString("id-ID")} ` +
              `(${partner.companyPercent}% bagian company dari total Rp${finalPriceAmount.toLocaleString("id-ID")}). ` +
              `Saldo tersedia: Rp${summary.available.toLocaleString("id-ID")} ` +
              `(dari Rp${summary.balance.toLocaleString("id-ID")}, ` +
              `Rp${summary.reserved.toLocaleString("id-ID")} terreserve withdrawal aktif). ` +
              `Silakan top-up wallet terlebih dahulu sebelum menghitung harga shipment.`,
            { wallet: ["Saldo wallet tidak mencukupi untuk bagian company."] },
          );
        }
      }
    }

    // persist the tariff used so the snapshot (and future re-calcs) is deterministic
    const updated = await db.masterShipment.update({
      where: { id: master.id },
      data: {
        tariffId: tariff.id,
        chargeableWeightKg: r.chargeableKg,
        ratePerKg: tariff.ratePerKg,
        priceAmount: r.price,
        pricedAt: new Date(),
        discountAmount,
        discountPercentage,
        finalPriceAmount,
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
