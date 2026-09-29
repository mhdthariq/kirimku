import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, requireNum, num, bool, dateOrNull } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "tariff.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const activeOnly = bool(params.get("active_only"), false);
    const tariffs = await db.tariff.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(search
          ? {
              OR: [
                { origin: { contains: search } },
                { destination: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ origin: "asc" }, { destination: "asc" }, { customerType: "asc" }],
    });
    return ok(tariffs);
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "tariff.create");
    const body = await req.json().catch(() => ({}));
    const origin = requireStr(body.origin, "origin");
    const destination = requireStr(body.destination, "destination");
    const customerType = body.customerType === "b2b" || body.customerType === "b2c" ? body.customerType : null;
    const duplicate = await db.tariff.findFirst({
      where: { origin, destination, customerType, isActive: true },
    });
    if (duplicate) {
      return fail(422, `Tarif aktif ${origin} → ${destination}${customerType ? ` (${customerType})` : ""} sudah ada. Nonaktifkan dulu yang lama.`, {
        origin: ["Tarif untuk kombinasi ini sudah ada."],
      });
    }

    // B2B pricing method — /kg (default), /koli, or /cubic (m³). B2C (and
    // generic "semua tipe") tariffs are ALWAYS forced to PER_KG server-side,
    // regardless of what the client sends — B2C never uses /koli or /cubic.
    const pricingMethodRaw = customerType === "b2b" && (body.pricingMethod === "PER_KOLI" || body.pricingMethod === "PER_CUBIC")
      ? body.pricingMethod
      : "PER_KG";
    if (pricingMethodRaw === "PER_KOLI" && !(num(body.ratePerKoli) && num(body.ratePerKoli)! > 0)) {
      return fail(422, "Tarif per koli wajib diisi untuk metode harga /koli.", { ratePerKoli: ["Tarif per koli wajib diisi (> 0)."] });
    }
    if (pricingMethodRaw === "PER_CUBIC" && !(num(body.ratePerCubic) && num(body.ratePerCubic)! > 0)) {
      return fail(422, "Tarif per m³ wajib diisi untuk metode harga /cubic.", { ratePerCubic: ["Tarif per m³ wajib diisi (> 0)."] });
    }

    const tariff = await db.tariff.create({
      data: {
        origin,
        destination,
        customerType,
        ratePerKg: pricingMethodRaw === "PER_KG" ? requireNum(body.ratePerKg, "ratePerKg", 1) : num(body.ratePerKg) ?? 0,
        minChargeableKg: num(body.minChargeableKg) ?? 1,
        volumetricMultiplier: num(body.volumetricMultiplier) ?? 250,
        roundingMode: body.roundingMode === "NEAREST" ? "NEAREST" : "UP",
        roundingUnitKg: num(body.roundingUnitKg) ?? 0.5,
        pricingMethod: pricingMethodRaw,
        ratePerKoli: pricingMethodRaw === "PER_KOLI" ? num(body.ratePerKoli) : null,
        ratePerCubic: pricingMethodRaw === "PER_CUBIC" ? num(body.ratePerCubic) : null,
        minChargeableKoli: num(body.minChargeableKoli) ?? 1,
        minChargeableM3: num(body.minChargeableM3) ?? 0,
        effectiveFrom: dateOrNull(body.effectiveFrom) ?? new Date(),
        effectiveTo: dateOrNull(body.effectiveTo),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "tariff", entityId: tariff.id, entityLabel: `${origin} → ${destination} (${customerType ?? "semua"})`, actor: user, after: tariff });
    return ok(tariff);
  });
}
