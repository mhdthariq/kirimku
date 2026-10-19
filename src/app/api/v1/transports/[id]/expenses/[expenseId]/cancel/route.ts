import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { db } from "@/infrastructure/persistence/db";
import { assertTransportAccess } from "@/infrastructure/services/transport-ops-server";
import { reverseExpense } from "@/infrastructure/services/expense-reversal";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; expenseId: string }> }) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.approve");
    const { id, expenseId } = await params;
    if (![id, expenseId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) return fail(422, "ID biaya atau transport tidak valid.");
    const expense = await db.transportExpense.findFirst({ where: { id: Number(expenseId), transportId: Number(id) }, include: { transport: { include: { route: true, shipments: { include: { master: true } } } } } });
    if (!expense?.transport) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);
    const body = (await req.json().catch(() => ({}))) ?? {};
    return ok(await reverseExpense(user, expense, "cancel", body.reason));
  });
}
