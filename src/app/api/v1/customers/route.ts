import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, requireStr, str, bool } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "customer.view");
    const search = str(req.nextUrl.searchParams.get("search"))?.toLowerCase();
    const includeInactive = bool(req.nextUrl.searchParams.get("include_inactive"), true);
    const customers = await db.customer.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { code: { contains: search } },
                { companyName: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { id: "desc" },
    });
    return ok(customers);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "customer.create");
    const body = await req.json().catch(() => ({}));
    const type = body.type === "b2b" ? "b2b" : "b2c";
    const name = requireStr(body.name, "name");

    const code = await nextCode("customer", "CUS-", "code");
    const customer = await db.customer.create({
      data: {
        code,
        type,
        name,
        companyName: str(body.companyName),
        phone: str(body.phone),
        email: str(body.email),
        address: str(body.address),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "customer", entityId: customer.id, entityLabel: customer.name, actor: user, after: customer });
    return ok(customer, undefined);
  });
}
