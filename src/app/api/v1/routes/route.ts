import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, requireStr, str, bool } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "checkpoint.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const includeInactive = bool(params.get("include_inactive"), true);

    const routes = await db.route.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search ? { OR: [{ name: { contains: search } }, { origin: { contains: search } }, { destination: { contains: search } }] } : {}),
      },
      orderBy: { id: "desc" },
      include: { checkpoints: { orderBy: { sequence: "asc" } }, _count: { select: { transports: true } } },
    });
    return ok(routes);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "checkpoint.create");
    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");
    const route = await db.route.create({
      data: {
        name,
        origin: str(body.origin),
        destination: str(body.destination),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "route", entityId: route.id, entityLabel: route.name, actor: user, after: route });
    return ok(route);
  });
}
