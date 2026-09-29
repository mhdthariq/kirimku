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
                { name: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ origin: "asc" }, { destination: "asc" }, { customerType: "asc" }],
      include: { customer: { select: { id: true, code: true, name: true, companyName: true } } },
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
    const name = str(body.name);

    // B2B tariffs are tied to ONE specific B2B customer. B2C / generic tariffs
    // are never customer-specific.
    let customerId: number | null = null;
    if (customerType === "b2b") {
      const cid = num(body.customerId);
      if (cid == null) return fail(422, "Tarif B2B wajib terikat ke satu customer B2B.", { customerId: ["Pilih customer B2B."] });
      const customer = await db.customer.findUnique({ where: { id: cid } });
      if (!customer || customer.type !== "b2b") {
        return fail(422, "Customer tidak ditemukan / bukan B2B.", { customerId: ["Customer harus bertipe B2B."] });
      }
      customerId = customer.id;
    }

    // The same corridor may have several tariffs as long as the NAME differs
    // (per customer for B2B). Only an identical name+corridor+customer clashes.
    const duplicate = await db.tariff.findFirst({
      where: { origin, destination, customerType, customerId, name, isActive: true },
    });
    if (duplicate) {
      return fail(422, `Tarif aktif ${name ? `“${name}” ` : ""}${origin} → ${destination}${customerType ? ` (${customerType})` : ""} sudah ada. Pakai nama tarif lain atau nonaktifkan yang lama.`, {
        name: ["Nama tarif sudah dipakai untuk koridor ini."],
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
        name,
        origin,
        destination,
        customerType,
        customerId,
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
    await audit({ action: "created", entityType: "tariff", entityId: tariff.id, entityLabel: `${name ? `${name} · ` : ""}${origin} → ${destination} (${customerType ?? "semua"})`, actor: user, after: tariff });
    return ok(tariff);
  });
}
