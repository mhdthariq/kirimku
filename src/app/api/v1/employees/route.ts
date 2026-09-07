import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, requireStr, str, bool, ci } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "employee.view");
    const params = req.nextUrl.searchParams;
    const search = str(params.get("search"))?.toLowerCase();
    const includeInactive = bool(params.get("include_inactive"), true);
    const employees = await db.employee.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(search
          ? { OR: [{ name: ci(search) }, { employeeNumber: ci(search) }, { position: ci(search) }] }
          : {}),
      },
      orderBy: { id: "asc" },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    return ok(employees);
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "employee.create");
    const body = await req.json().catch(() => ({}));
    const name = requireStr(body.name, "name");
    const employee = await db.employee.create({
      data: {
        employeeNumber: await nextCode("employee", "EMP-", "employeeNumber"),
        name,
        phone: str(body.phone),
        position: str(body.position),
        isActive: true,
      },
    });
    await audit({ action: "created", entityType: "employee", entityId: employee.id, entityLabel: employee.name, actor: user, after: employee });
    return ok(employee);
  });
}
