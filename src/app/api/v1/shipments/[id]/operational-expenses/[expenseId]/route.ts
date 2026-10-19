import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { db } from "@/infrastructure/persistence/db";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { reverseExpense } from "@/infrastructure/services/expense-reversal";
import { audit } from "@/infrastructure/services/audit";
import { hasPermission } from "@/infrastructure/auth/auth";

type Params = { params: Promise<{ id: string; expenseId: string }> };
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.approve");
    const { id, expenseId } = await params;
    if (![id, expenseId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) return fail(422, "ID biaya atau shipment tidak valid.");
    const expense = await db.transportExpense.findFirst({ where: { id: Number(expenseId), shipmentId: Number(id) }, include: { shipment: true } });
    if (!expense?.shipment) return fail(404, "Biaya tidak ditemukan.");
    await assertShipmentScope(user, expense.shipment);
    const body = (await req.json().catch(() => ({}))) ?? {};
    if (body.action === "cancel") return ok(await reverseExpense(user, expense, "cancel", body.reason));
    if (body.action !== "approve") return fail(422, "Tindakan tidak valid.");
    if (expense.status !== "PENDING") return fail(409, "Hanya biaya PENDING yang dapat disetujui.");
    const approval = { status: "APPROVED", approvedAt: new Date(), approvedById: user.id, approvedByUsername: user.username, approvedByRole: user.isOwner ? "Owner" : user.roles.map(role => role.name).sort().join(", ") };
    const result = await db.transportExpense.updateMany({ where: { id: expense.id, shipmentId: Number(id), status: "PENDING" }, data: approval });
    if (result.count !== 1) return fail(409, "Biaya berubah. Muat ulang data.");
    await audit({ action: "approve", entityType: "transport_expense", entityId: expense.id, actor: user, after: approval });
    return ok(approval);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req);
    const { id, expenseId } = await params;
    if (![id, expenseId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) return fail(422, "ID biaya atau shipment tidak valid.");
    const expense = await db.transportExpense.findFirst({ where: { id: Number(expenseId), shipmentId: Number(id) }, include: { shipment: true } });
    if (!expense?.shipment) return fail(404, "Biaya tidak ditemukan.");
    await assertShipmentScope(user, expense.shipment);
    const body = (await req.json().catch(() => ({}))) ?? {};
    if (expense.status !== "PENDING") return ok(await reverseExpense(user, expense, "remove", body.reason));
    if (!hasPermission(user, "transport.expense.delete")) return fail(403, "Missing permission: transport.expense.delete");
    const result = await db.transportExpense.deleteMany({ where: { id: expense.id, shipmentId: Number(id), status: "PENDING" } });
    if (result.count !== 1) return fail(409, "Biaya berubah. Muat ulang data.");
    await audit({ action: "delete", entityType: "transport_expense", entityId: expense.id, actor: user, before: expense });
    return ok({ deleted: true });
  });
}
