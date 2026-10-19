import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertTransportAccess } from "@/infrastructure/services/transport-ops-server";
import { expensePhotoUrls } from "@/domain/expense-photos";

type Params = { params: Promise<{ id: string; expenseId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.approve");
    const { id, expenseId } = await params;
    const expense = await db.transportExpense.findFirst({
      where: { id: Number(expenseId), transportId: Number(id) },
      include: { transport: { include: { route: true, shipments: { include: { master: true } } } } },
    });
    if (!expense?.transport) return fail(404, "Biaya tidak ditemukan.");
    await assertTransportAccess(user, expense.transport);
    if (expense.status !== "PENDING") return fail(409, "Biaya sudah disetujui.");

    // Persist display names, not a live role reference: later account changes must not rewrite history.
    const approval = {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: user.id,
      approvedByUsername: user.username,
      approvedByRole: user.isOwner ? "Owner" : user.roles.map((role) => role.name).sort().join(", "),
    };
    const result = await db.transportExpense.updateMany({
      where: { id: expense.id, transportId: expense.transportId, status: "PENDING" },
      data: approval,
    });
    if (result.count !== 1) return fail(409, "Biaya telah disetujui atau dihapus. Muat ulang data.");
    await audit({
      action: "approve", entityType: "transport_expense", entityId: expense.id,
      entityLabel: `${expense.transport.transportCode} · ${expense.expenseCode} → APPROVED`,
      actor: user, before: { status: expense.status }, after: approval,
    });
    const updated = await db.transportExpense.findUnique({ where: { id: expense.id } });
    if (!updated) return fail(404, "Biaya tidak ditemukan.");
    const { photoUrl, photoUrls, ...rest } = updated;
    const photoCount = expensePhotoUrls({ photoUrl, photoUrls }).length;
    return ok({ ...rest, hasPhoto: photoCount > 0, photoCount });
  });
}
