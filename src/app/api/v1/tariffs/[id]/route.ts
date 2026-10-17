import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, str, requireNum, num, dateOrNull } from "@/composition/api-helpers";
import { audit, diffFields } from "@/infrastructure/services/audit";
import { expireTariffs, isTariffConflict, tariffEndDate } from "@/infrastructure/services/tariff-lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "tariff.update");
    await expireTariffs();
    const { id } = await params;
    const existing = await db.tariff.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Tariff tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.origin !== undefined) data.origin = str(body.origin) ?? existing.origin;
    if (body.destination !== undefined) data.destination = str(body.destination) ?? existing.destination;
    if (body.name !== undefined) data.name = str(body.name);
    if (body.customerType !== undefined) data.customerType = body.customerType === "b2b" || body.customerType === "b2c" ? body.customerType : null;

    // Resolve the effective customerType (after this update) and pricing
    // method together. B2C tariffs may use any pricing method but never a
    // customer relation.
    const effectiveCustomerType = (data.customerType as string | null | undefined) !== undefined ? (data.customerType as string | null) : existing.customerType;
    if (effectiveCustomerType !== "b2b") {
      data.customerId = null;
    } else if (body.customerId !== undefined) {
      const cid = num(body.customerId);
      const customer = cid != null ? await db.customer.findUnique({ where: { id: cid } }) : null;
      if (!customer || customer.type !== "b2b") {
        return fail(422, "Customer tidak ditemukan / bukan B2B.", { customerId: ["Customer harus bertipe B2B."] });
      }
      data.customerId = customer.id;
    }
    const requestedMethod = body.pricingMethod === "PER_KG_SIMPLE" || body.pricingMethod === "PER_KOLI" || body.pricingMethod === "PER_CUBIC" ? body.pricingMethod : body.pricingMethod === "PER_KG" ? "PER_KG" : undefined;
    if (requestedMethod === "PER_KG_SIMPLE" && effectiveCustomerType === "b2b") {
      return fail(422, "Metode kg aktual hanya tersedia untuk tarif B2C.", { pricingMethod: ["Pilih metode harga B2B yang tersedia."] });
    }
    if (requestedMethod !== undefined) {
      data.pricingMethod = requestedMethod;
    }
    const finalMethod = (data.pricingMethod as string | undefined) ?? existing.pricingMethod;

    if (body.ratePerKg !== undefined) data.ratePerKg = (finalMethod === "PER_KG" || finalMethod === "PER_KG_SIMPLE") ? requireNum(body.ratePerKg, "ratePerKg", 1) : num(body.ratePerKg) ?? existing.ratePerKg;
    if (body.ratePerKoli !== undefined) data.ratePerKoli = num(body.ratePerKoli);
    if (body.ratePerCubic !== undefined) data.ratePerCubic = num(body.ratePerCubic);
    if (body.minChargeableKoli !== undefined) data.minChargeableKoli = num(body.minChargeableKoli) ?? existing.minChargeableKoli;
    if (body.minChargeableM3 !== undefined) data.minChargeableM3 = num(body.minChargeableM3) ?? existing.minChargeableM3;

    const nextRatePerKoli = (data.ratePerKoli as number | null | undefined) !== undefined ? (data.ratePerKoli as number | null) : existing.ratePerKoli;
    const nextRatePerCubic = (data.ratePerCubic as number | null | undefined) !== undefined ? (data.ratePerCubic as number | null) : existing.ratePerCubic;
    if (finalMethod === "PER_KOLI" && !(nextRatePerKoli && nextRatePerKoli > 0)) {
      return fail(422, "Tarif per koli wajib diisi untuk metode harga /koli.", { ratePerKoli: ["Tarif per koli wajib diisi (> 0)."] });
    }
    if (finalMethod === "PER_CUBIC" && !(nextRatePerCubic && nextRatePerCubic > 0)) {
      return fail(422, "Tarif per m³ wajib diisi untuk metode harga /cubic.", { ratePerCubic: ["Tarif per m³ wajib diisi (> 0)."] });
    }

    if (body.minChargeableKg !== undefined) data.minChargeableKg = num(body.minChargeableKg) ?? existing.minChargeableKg;
    if (body.volumetricMultiplier !== undefined) data.volumetricMultiplier = num(body.volumetricMultiplier) ?? existing.volumetricMultiplier;
    if (body.roundingMode !== undefined) data.roundingMode = body.roundingMode === "NEAREST" ? "NEAREST" : "UP";
    if (body.roundingUnitKg !== undefined) data.roundingUnitKg = num(body.roundingUnitKg) ?? existing.roundingUnitKg;
    if (body.effectiveFrom !== undefined) data.effectiveFrom = dateOrNull(body.effectiveFrom) ?? existing.effectiveFrom;
    if (body.effectiveTo !== undefined) data.effectiveTo = tariffEndDate(body.effectiveTo);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const effectiveFrom = (data.effectiveFrom as Date | undefined) ?? existing.effectiveFrom;
    const effectiveTo = data.effectiveTo !== undefined ? data.effectiveTo as Date | null : existing.effectiveTo;
    if ((body.effectiveFrom && !dateOrNull(body.effectiveFrom)) || (body.effectiveTo && !effectiveTo) || (effectiveTo && effectiveTo < effectiveFrom)) {
      return fail(422, "Masa berlaku tarif tidak valid.");
    }
    const isActive = effectiveTo && effectiveTo < new Date() ? false : (data.isActive as boolean | undefined) ?? existing.isActive;
    data.isActive = isActive;
    if (isActive) {
      const duplicate = await db.tariff.findFirst({ where: {
        id: { not: existing.id }, isActive: true,
        origin: (data.origin as string | undefined) ?? existing.origin,
        destination: (data.destination as string | undefined) ?? existing.destination,
        name: data.name !== undefined ? data.name as string | null : existing.name,
        customerType: effectiveCustomerType,
        customerId: data.customerId !== undefined ? data.customerId as number | null : existing.customerId,
      } });
      if (duplicate) return fail(422, "Tarif aktif dengan nama, koridor, dan customer ini sudah ada.");
    }
    const tariff = await db.tariff.update({ where: { id: existing.id }, data }).catch((error: unknown) => {
      if (isTariffConflict(error)) return null;
      throw error;
    });
    if (!tariff) return fail(422, "Tarif aktif dengan nama, koridor, dan customer ini sudah ada.");
    await audit({ action: "updated", entityType: "tariff", entityId: tariff.id, entityLabel: `${tariff.origin} → ${tariff.destination} (${tariff.customerType ?? "semua"})`, actor: user, before: diffFields(existing, tariff as unknown as Record<string, unknown>) });
    return ok(tariff);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "tariff.update");
    const { id } = await params;
    const existing = await db.tariff.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Tariff tidak ditemukan.");
    const priced = await db.masterShipment.count({ where: { ratePerKg: existing.ratePerKg, pricedAt: { not: null } } });
    if (priced > 0) {
      const tariff = await db.tariff.update({ where: { id: existing.id }, data: { isActive: false } });
      await audit({ action: "deactivated", entityType: "tariff", entityId: tariff.id, entityLabel: `${tariff.origin} → ${tariff.destination}`, actor: user });
      return ok({ deactivated: true, tariff });
    }
    await db.tariff.delete({ where: { id: existing.id } });
    await audit({ action: "deleted", entityType: "tariff", entityId: existing.id, entityLabel: `${existing.origin} → ${existing.destination}`, actor: user, before: existing });
    return ok({ deleted: true });
  });
}
