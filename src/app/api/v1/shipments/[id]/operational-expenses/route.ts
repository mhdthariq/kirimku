import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { hasPermission } from "@/infrastructure/auth/auth";
import { db } from "@/infrastructure/persistence/db";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { assertTransportAccess } from "@/infrastructure/services/transport-ops-server";
import { expenseReportSelect } from "@/infrastructure/services/operational-expense-report";
import { HttpError } from "@/shared/http-error";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.view");
    if (!hasPermission(user, "transport.expense.view")) return fail(403, "Missing permission: transport.expense.view");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Shipment tidak valid.");
    const shipment = await db.masterShipment.findUnique({ where: { id }, include: { transportItems: { include: { transport: { include: { route: true, shipments: { include: { master: true } } } } } } } });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, shipment);
    const transportIds = new Set<number>();
    for (const item of shipment.transportItems) {
      try { await assertTransportAccess(user, item.transport); transportIds.add(item.transport.id); }
      catch (error) { if (!(error instanceof HttpError && error.status === 403)) throw error; }
    }
    const rows = await db.transportExpense.findMany({ where: { transportId: { in: [...transportIds] } }, select: expenseReportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return ok({ shared: true, rows, approvedTotal: rows.filter(r => r.status === "APPROVED").reduce((sum, r) => sum + r.amount, 0), pendingTotal: rows.filter(r => r.status === "PENDING").reduce((sum, r) => sum + r.amount, 0) });
  });
}
