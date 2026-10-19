import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, str } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { validateExpense, validateExpenseLocation } from "@/domain/transport-ops";
import { assertTransportAccess, parseOptionalPhoto } from "@/infrastructure/services/transport-ops-server";
import { reverseExpense } from "@/infrastructure/services/expense-reversal";
import { hasPermission } from "@/infrastructure/auth/auth";

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
    if (!expense?.transport) return fail(404, "Biaya tidak ditemukan.");
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
    if (!expense?.transport) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);

    if (expense.transport.status === "COMPLETED") return fail(409, "Transport sudah COMPLETED. Biaya operasional dan foto tidak dapat diubah.");
    if (expense.status !== "PENDING") return fail(409, "Biaya yang sudah disetujui tidak dapat diubah.");
    const parsed = await req.json().catch(() => null);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const problem = validateExpense({ type: body.type ?? expense.type, amount: body.amount ?? expense.amount });
    if (problem) return fail(422, problem, { type: [problem] });

    const locationProblem = validateExpenseLocation(body);
    if (locationProblem) return fail(422, locationProblem, { location: [locationProblem] });
    const data: Record<string, unknown> = {
      latitude: body.latitude, longitude: body.longitude, locationAccuracy: body.locationAccuracy,
    };
    if (body.type !== undefined) data.type = String(body.type);
    if (body.amount !== undefined) data.amount = Number(body.amount);
    if (body.description !== undefined) data.description = str(body.description);
    if (body.removePhoto === true) data.photoUrl = null;
    if (body.photo !== undefined && body.photo !== "") {
      const photo = parseOptionalPhoto(body.photo);
      if (photo.error) return fail(422, photo.error, { photo: [photo.error] });
      data.photoUrl = photo.photoUrl;
    }

    const result = await db.transportExpense.updateMany({ where: { id: expense.id, transportId: expense.transportId, status: "PENDING" }, data });
    if (result.count !== 1) return fail(409, "Biaya telah disetujui atau dihapus. Muat ulang data.");
    const updated = await db.transportExpense.findUnique({ where: { id: expense.id } });
    if (!updated) return fail(409, "Biaya telah dihapus. Muat ulang data.");
    await audit({
      action: "update",
      entityType: "transport_expense",
      entityId: updated.id,
      entityLabel: `${expense.transport.transportCode} · ${updated.type}`,
      actor: user,
      before: { type: expense.type, amount: expense.amount, latitude: expense.latitude, longitude: expense.longitude, locationAccuracy: expense.locationAccuracy },
      after: { ...data },
    });
    const { photoUrl, ...rest } = updated;
    return ok({ ...rest, hasPhoto: photoUrl != null });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req);
    const { id, expenseId } = await params;
    const expense = await load(id, expenseId);
    if (!expense?.transport) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);
    if (expense.status !== "PENDING") {
      const body = (await req.json().catch(() => ({}))) ?? {};
      return ok(await reverseExpense(user, expense, "remove", body.reason));
    }
    if (!hasPermission(user, "transport.expense.delete")) return fail(403, "Missing permission: transport.expense.delete");
    const result = await db.transportExpense.deleteMany({ where: { id: expense.id, transportId: expense.transportId, status: "PENDING" } });
    if (result.count !== 1) return fail(409, "Biaya telah disetujui atau dihapus. Muat ulang data.");
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
