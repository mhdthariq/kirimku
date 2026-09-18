import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, bool, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

/** Helper: marketing partners only ever see / manage customers connected to
 *  them (Customer.marketingPartnerId). Admin/owner accounts see everyone. */
function marketingScope(user: { partnerType: string | null; partnerId: number | null }) {
  return user.partnerType === "MARKETING" && user.partnerId != null ? user.partnerId : null;
}

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "customer.view");
    const search = str(req.nextUrl.searchParams.get("search"))?.toLowerCase();
    const includeInactive = bool(req.nextUrl.searchParams.get("include_inactive"), true);
    // Marketing data separation: a marketing partner only sees THEIR customers.
    const partnerId = marketingScope(user);
    const customers = await db.customer.findMany({
      where: {
        ...(partnerId != null ? { marketingPartnerId: partnerId } : {}),
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
      include: { marketingPartner: { select: { id: true, user: { select: { name: true } } } } },
    });
    return ok(
      customers.map((c) => ({
        ...c,
        marketingPartnerName: c.marketingPartner?.user?.name ?? null,
        marketingPartner: undefined,
      })),
    );
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "customer.create");
    const body = await req.json().catch(() => ({}));
    const type = body.type === "b2b" ? "b2b" : "b2c";
    const name = requireStr(body.name, "name");

    // Customer ↔ Marketing linkage ("customer connected to who"):
    // - a Marketing partner creating a customer → automatically THEIR customer
    // - admin/owner creating → optional marketingPartnerId from the body
    const selfPartnerId = marketingScope(user);
    let marketingPartnerId: number | null = selfPartnerId;
    if (marketingPartnerId == null && body.marketingPartnerId != null) {
      const pid = num(body.marketingPartnerId);
      if (pid != null) {
        const partner = await db.partner.findUnique({ where: { id: pid } });
        if (!partner || partner.type !== "MARKETING" || !partner.isActive) {
          return fail(422, "Marketing partner tidak ditemukan / bukan bertipe MARKETING.", {
            marketingPartnerId: ["Marketing partner tidak valid."],
          });
        }
        marketingPartnerId = partner.id;
      }
    }

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
        marketingPartnerId,
      },
    });
    await audit({ action: "created", entityType: "customer", entityId: customer.id, entityLabel: customer.name, actor: user, after: customer });
    return ok(customer, undefined);
  });
}
