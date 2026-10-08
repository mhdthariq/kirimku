import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, requireStr, str, bool, num } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { nextCode } from "@/infrastructure/services/code-generator";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "employee.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"));
    const includeInactive = bool(params.get("include_inactive"), true);
    const employees = await db.employee.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { employeeNumber: { contains: search, mode: "insensitive" } }, { position: { contains: search, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: { id: "asc" },
      include: { user: { include: { roles: { include: { role: true } } } }, warehouse: { select: { id: true, name: true, city: true } } },
    });
    return ok(employees);
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "employee.create");
    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");
    const employee = await db.employee.create({
      data: {
        employeeNumber: await nextCode("employee", "EMP-", "employeeNumber"),
        name,
        phone: str(body.phone),
        position: str(body.position),
        warehouseId: num(body.warehouseId),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "employee", entityId: employee.id, entityLabel: employee.name, actor: user, after: employee });
    return ok(employee);
  });
}
