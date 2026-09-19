import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, requireStr, str, bool, num } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { scopeForUser } from "@/lib/gudang-scope";

/** Helper: marketing partners only ever see / manage customers connected to
 *  them (Customer.marketingPartnerId). Admin/owner accounts see everyone. */
function marketingScope(user: { partnerType: string | null; partnerId: number | null }) {
  return user.partnerType === "MARKETING" && user.partnerId != null ? user.partnerId : null;
}

/** Helper: gudang-scoped customer filter. Customers with warehouseId set are
 *  only visible to that gudang's admins; general customers (warehouseId=null)
 *  are visible to everyone. Owners / unscoped users see all customers. */
async function customerGudangClause(user: {
  isOwner: boolean;
  permissions: string[];
  employeeId: number | null;
}) {
  const scope = await scopeForUser(user);
  if (scope.unscoped) return {};
  return {
    OR: [
      { warehouseId: null },
      ...(scope.warehouseId != null ? [{ warehouseId: scope.warehouseId }] : []),
    ],
  };
}

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "customer.view");
    const search = str(req.nextUrl.searchParams.get("search"))?.toLowerCase();
    const includeInactive = bool(req.nextUrl.searchParams.get("include_inactive"), true);
    // Marketing data separation: a marketing partner only sees THEIR customers.
    const partnerId = marketingScope(user);
    // Revise round 7 — Gudang scoping for customers.
    const gudangClause = await customerGudangClause(user);
    const customers = await db.customer.findMany({
      where: {
        ...(partnerId != null ? { marketingPartnerId: partnerId } : {}),
        ...gudangClause,
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
      include: {
        marketingPartner: { select: { id: true, user: { select: { name: true } } } },
        warehouse: { select: { id: true, name: true } },
      },
    });
    return ok(
      customers.map((c) => ({
        ...c,
        marketingPartnerName: c.marketingPartner?.user?.name ?? null,
        marketingPartner: undefined,
        warehouseName: c.warehouse?.name ?? null,
        warehouse: undefined,
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

    // Revise round 7 — Gudang attachment for customers. Optional: when set,
    // only that gudang's admins/staff see this customer in their lists.
    // null / "general" / "none" → umum (visible to all gudangs).
    let warehouseId: number | null = null;
    if (body.warehouseId !== undefined && body.warehouseId !== null && body.warehouseId !== "") {
      if (body.warehouseId !== "general" && body.warehouseId !== "none") {
        const wid = num(body.warehouseId);
        if (wid == null) {
          return fail(422, "Gudang tidak valid.", { warehouseId: ["Gudang tidak valid."] });
        }
        const warehouse = await db.warehouse.findUnique({ where: { id: wid } });
        if (!warehouse || !warehouse.isActive) {
          return fail(422, "Gudang tidak ditemukan / tidak aktif.", { warehouseId: ["Gudang tidak ditemukan / tidak aktif."] });
        }
        warehouseId = warehouse.id;
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
        warehouseId,
      },
    });
    await audit({ action: "created", entityType: "customer", entityId: customer.id, entityLabel: customer.name, actor: user, after: customer });
    return ok(customer, undefined);
  });
}
