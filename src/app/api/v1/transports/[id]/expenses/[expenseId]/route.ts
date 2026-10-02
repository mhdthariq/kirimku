import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { validateExpense } from "@/lib/transport-ops";
import { assertTransportAccess, parseOptionalPhoto } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function load(id: string, expenseId: string) {
  const expense = await db.transportExpense.findFirst({
    where: { id: Number(expenseId), transportId: Number(id) },
    include: { transport: { include: { route: true, shipments: { include: { master: true } } } } },
  });
  return expense;
}

/** GET …/expenses/:expenseId — a single expense INCLUDING its photo (for the viewer). */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.view");
    const { id, expenseId } = await params;
    const expense = await load(id, expenseId);
    if (!expense) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);
    const { transport: _t, ...rest } = expense;
    return ok(rest);
  });
}

/** PUT — { type?, amount?, description?, photo? , removePhoto? } */
export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.update");
    const { id, expenseId } = await params;
    const expense = await load(id, expenseId);
    if (!expense) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);

    const body = await req.json().catch(() => ({}));
    const problem = validateExpense({ type: body.type ?? expense.type, amount: body.amount ?? expense.amount });
    if (problem) return fail(422, problem, { type: [problem] });

    const data: Record<string, unknown> = {};
    if (body.type !== undefined) data.type = String(body.type);
    if (body.amount !== undefined) data.amount = Number(body.amount);
    if (body.description !== undefined) data.description = str(body.description);
    if (body.removePhoto === true) data.photoUrl = null;
    if (body.photo !== undefined && body.photo !== "") {
      const photo = parseOptionalPhoto(body.photo);
      if (photo.error) return fail(422, photo.error, { photo: [photo.error] });
      data.photoUrl = photo.photoUrl;
    }

    const updated = await db.transportExpense.update({ where: { id: expense.id }, data });
    await audit({
      action: "update",
      entityType: "transport_expense",
      entityId: updated.id,
      entityLabel: `${expense.transport.transportCode} · ${updated.type}`,
      actor: user,
      before: { type: expense.type, amount: expense.amount },
      after: { type: updated.type, amount: updated.amount },
    });
    const { photoUrl, ...rest } = updated;
    return ok({ ...rest, hasPhoto: photoUrl != null });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.delete");
    const { id, expenseId } = await params;
    const expense = await load(id, expenseId);
    if (!expense) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);
    await db.transportExpense.delete({ where: { id: expense.id } });
    await audit({
      action: "delete",
      entityType: "transport_expense",
      entityId: expense.id,
      entityLabel: `${expense.transport.transportCode} · ${expense.type} Rp${expense.amount.toLocaleString("id-ID")}`,
      actor: user,
      before: { type: expense.type, amount: expense.amount },
    });
    return ok({ deleted: true });
  });
}
