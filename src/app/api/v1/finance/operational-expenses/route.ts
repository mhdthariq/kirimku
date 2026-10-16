import { NextRequest } from "next/server";
import { guard, handle, ok, fail, str } from "@/composition/api-helpers";
import { isExpenseType } from "@/domain/transport-ops";
import { operationalExpenseReport } from "@/infrastructure/services/operational-expense-report";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "financial.report.view");
    const params = req.nextUrl.searchParams;
    const type = str(params.get("type"));
    const status = str(params.get("status"));
    const search = str(params.get("search"));
    const page = Number(params.get("page") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return fail(422, "Halaman tidak valid.");
    if (type && !isExpenseType(type)) return fail(422, "Jenis biaya tidak valid.");
    if (status && !["APPROVED", "PENDING"].includes(status)) return fail(422, "Status biaya tidak valid.");
    if (search && search.length > 150) return fail(422, "Pencarian maksimal 150 karakter.");
    return ok(await operationalExpenseReport({
      ...(type ? { type } : {}), ...(status ? { status } : {}),
      ...(search ? { OR: [{ expenseCode: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }, { transport: { transportCode: { contains: search, mode: "insensitive" as const } } }] } : {}),
    }, page));
  });
}
