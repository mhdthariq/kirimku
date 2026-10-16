import { db } from "@/infrastructure/persistence/db";
import { EXPENSE_TYPES, EXPENSE_LABEL } from "@/domain/transport-ops";
import type { Prisma } from "@prisma/client";

export const expenseReportSelect = {
  id: true, expenseCode: true, type: true, amount: true, description: true, status: true, createdAt: true,
  transport: { select: { id: true, transportCode: true, origin: true, destination: true } },
} satisfies Prisma.TransportExpenseSelect;

/** Aggregate the expense table itself, never joins to shipments (which multiply shared costs). */
export async function operationalExpenseReport(where: Prisma.TransportExpenseWhereInput, page: number) {
  const [groups, rows, count] = await Promise.all([
    db.transportExpense.groupBy({ by: ["type", "status"], _sum: { amount: true }, _count: { _all: true } }),
    db.transportExpense.findMany({ where, select: expenseReportSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 }),
    db.transportExpense.count({ where }),
  ]);
  const byType = EXPENSE_TYPES.map(type => {
    const approved = groups.find(g => g.type === type && g.status === "APPROVED");
    const pending = groups.find(g => g.type === type && g.status === "PENDING");
    return { type, label: EXPENSE_LABEL[type], approved: approved?._sum.amount ?? 0, pending: pending?._sum.amount ?? 0, count: (approved?._count._all ?? 0) + (pending?._count._all ?? 0) };
  });
  return {
    approvedTotal: byType.reduce((sum, row) => sum + row.approved, 0),
    pendingTotal: byType.reduce((sum, row) => sum + row.pending, 0),
    byType, rows, count, page, pageSize: 25, pages: Math.max(1, Math.ceil(count / 25)),
  };
}
