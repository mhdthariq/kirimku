import { db } from "@/infrastructure/persistence/db";
import { hasPermission, type AuthUser } from "@/infrastructure/auth/auth";
import { HttpError } from "@/shared/http-error";

/** A reason and approver permission are mandatory for reversing approved costs. */
export async function reverseExpense(user: AuthUser, expense: { id: number; status: string; expenseCode: string; amount: number }, action: "cancel" | "remove", input: unknown) {
  if (!hasPermission(user, "transport.expense.approve")) throw new HttpError(403, "Missing permission: transport.expense.approve");
  const reason = typeof input === "string" ? input.trim() : "";
  if (!reason || reason.length > 1000) throw new HttpError(422, "Alasan wajib diisi (maksimal 1000 karakter).");
  if (action === "cancel" && expense.status !== "APPROVED") throw new HttpError(409, "Hanya biaya APPROVED yang dapat dibatalkan.");
  if (action === "remove" && !["APPROVED", "CANCELLED"].includes(expense.status)) throw new HttpError(409, "Status biaya tidak dapat dihapus melalui pembatalan approval.");
  await db.$transaction(async tx => {
    const where = { id: expense.id, status: expense.status };
    const result = action === "cancel"
      ? await tx.transportExpense.updateMany({ where, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, cancellationReason: reason } })
      : await tx.transportExpense.deleteMany({ where });
    if (result.count !== 1) throw new HttpError(409, "Biaya berubah. Muat ulang data.");
    // Mandatory transactional audit: a removed approved entry must retain its reason.
    await tx.auditLog.create({ data: { action, entityType: "transport_expense", entityId: expense.id, entityLabel: expense.expenseCode, actorId: user.id,
      beforeData: JSON.stringify(expense), afterData: JSON.stringify({ reason, status: action === "cancel" ? "CANCELLED" : "REMOVED" }) } });
  });
  return { status: action === "cancel" ? "CANCELLED" : "REMOVED" };
}
