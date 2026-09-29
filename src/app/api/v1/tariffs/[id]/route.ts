import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, requireNum, num, dateOrNull } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "tariff.update");
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
    // method together — B2C / generic tariffs are ALWAYS forced to PER_KG
    // server-side, regardless of what the client sends.
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
    const requestedMethod = body.pricingMethod === "PER_KOLI" || body.pricingMethod === "PER_CUBIC" ? body.pricingMethod : body.pricingMethod === "PER_KG" ? "PER_KG" : undefined;
    if (requestedMethod !== undefined) {
      data.pricingMethod = effectiveCustomerType === "b2b" ? requestedMethod : "PER_KG";
    } else if (effectiveCustomerType !== "b2b" && existing.pricingMethod !== "PER_KG") {
      // customerType changed away from b2b — fall back to /kg automatically.
      data.pricingMethod = "PER_KG";
    }
    const finalMethod = (data.pricingMethod as string | undefined) ?? existing.pricingMethod;

    if (body.ratePerKg !== undefined) data.ratePerKg = finalMethod === "PER_KG" ? requireNum(body.ratePerKg, "ratePerKg", 1) : num(body.ratePerKg) ?? existing.ratePerKg;
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
    if (body.effectiveTo !== undefined) data.effectiveTo = dateOrNull(body.effectiveTo);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    const tariff = await db.tariff.update({ where: { id: existing.id }, data });
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
