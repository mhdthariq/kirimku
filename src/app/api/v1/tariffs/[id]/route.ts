import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, requireNum, num, dateOrNull } from "@/lib/api-helpers";
import { audit, diffFields } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "tariff.update");
    const { id } = await params;
    const existing = await db.tariff.findUnique({ where: { id: Number(id) } });
    if (!existing) return fail(404, "Tariff tidak ditemukan.");
    const body = await req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (body.origin !== undefined) data.origin = str(body.origin) ?? existing.origin;
    if (body.destination !== undefined) data.destination = str(body.destination) ?? existing.destination;
    if (body.customerType !== undefined) data.customerType = body.customerType === "b2b" || body.customerType === "b2c" ? body.customerType : null;
    if (body.ratePerKg !== undefined) data.ratePerKg = requireNum(body.ratePerKg, "ratePerKg", 1);
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
  return handle(async () => {
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
