import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, requireNum, num, bool, dateOrNull } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return handle(async () => {
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
  return handle(async () => {
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
    const tariff = await db.tariff.create({
      data: {
        origin,
        destination,
        customerType,
        ratePerKg: requireNum(body.ratePerKg, "ratePerKg", 1),
        minChargeableKg: num(body.minChargeableKg) ?? 1,
        volumetricMultiplier: num(body.volumetricMultiplier) ?? 250,
        roundingMode: body.roundingMode === "NEAREST" ? "NEAREST" : "UP",
        roundingUnitKg: num(body.roundingUnitKg) ?? 0.5,
        effectiveFrom: dateOrNull(body.effectiveFrom) ?? new Date(),
        effectiveTo: dateOrNull(body.effectiveTo),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "tariff", entityId: tariff.id, entityLabel: `${origin} → ${destination} (${customerType ?? "semua"})`, actor: user, after: tariff });
    return ok(tariff);
  });
}
