import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, requireStr, str, num, bool } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

/**
 * Gudang (warehouse) master data. A gudang is a physical node shipments
 * travel through — there is intentionally NO `type` column: every node is
 * a gudang in this system.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "warehouse.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const includeInactive = bool(params.get("include_inactive"), true);

    const warehouses = await db.warehouse.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { code: { contains: search } },
                { city: { contains: search } },
                { address: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
    });
    return ok(warehouses);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "warehouse.create");
    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");

    const code = await nextCode("warehouse", "WH-", "code");
    const warehouse = await db.warehouse.create({
      data: {
        code,
        name,
        city: str(body.city),
        address: str(body.address),
        latitude: num(body.latitude),
        longitude: num(body.longitude),
        notes: str(body.notes),
        customerSupportContact: str(body.customerSupportContact),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "warehouse", entityId: warehouse.id, entityLabel: warehouse.name, actor: user, after: warehouse });
    return ok(warehouse);
  });
}
