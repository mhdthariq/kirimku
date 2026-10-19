import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { hasPermission } from "@/infrastructure/auth/auth";
import { db } from "@/infrastructure/persistence/db";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { expenseReportSelect } from "@/infrastructure/services/operational-expense-report";
import { HttpError } from "@/shared/http-error";
import { canEnterShipmentExpense } from "@/domain/shipment-expense";
import { validateExpense } from "@/domain/transport-ops";
import { nextCode } from "@/infrastructure/services/code-generator";
import { audit } from "@/infrastructure/services/audit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.view");
    if (!hasPermission(user, "transport.expense.view")) return fail(403, "Missing permission: transport.expense.view");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Shipment tidak valid.");
    const shipment = await db.masterShipment.findUnique({ where: { id }, include: { customer: true } });
    if (!shipment) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, shipment);
    const rows = await db.transportExpense.findMany({ where: { shipmentId: id }, select: expenseReportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return ok({ customerType: shipment.customer.type, canCreate: hasPermission(user, "shipment.expense.create") && canEnterShipmentExpense(shipment), rows, approvedTotal: rows.filter(r => r.status === "APPROVED").reduce((sum, r) => sum + r.amount, 0), pendingTotal: rows.filter(r => r.status === "PENDING").reduce((sum, r) => sum + r.amount, 0) });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const user = await guard(req, "shipment.expense.create");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Shipment tidak valid.");
    const body = (await req.json().catch(() => ({}))) ?? {};
    const problem = validateExpense({ type: body.type, amount: body.amount });
    if (problem) return fail(422, problem);
    const expenseCode = await nextCode("transportExpense", "EXP-2026-", "expenseCode");
    const created = await db.$transaction(async tx => {
      // Serialize receipt undo / expense entry against this shipment.
      await tx.$queryRaw`SELECT id FROM "MasterShipment" WHERE id = ${id} FOR UPDATE`;
      const shipment = await tx.masterShipment.findUnique({ where: { id }, include: { customer: true } });
      if (!shipment) throw new HttpError(404, "Shipment tidak ditemukan.");
      await assertShipmentScope(user, shipment);
      if (!canEnterShipmentExpense(shipment)) throw new HttpError(409, "Biaya hanya untuk B2B non-Marketing setelah konfirmasi tiba di gudang.");
      return tx.transportExpense.create({ data: { shipmentId: id, expenseCode, type: body.type, amount: Number(body.amount), description: typeof body.description === "string" ? body.description.trim().slice(0, 1000) : null, createdById: user.id, status: "PENDING" } });
    });
    await audit({ action: "create", entityType: "transport_expense", entityId: created.id, actor: user, after: created });
    return ok(created);
  });
}
