export function expenseProgress(rows: { amount: number; status?: string }[]) {
  const active = rows.filter(row => row.status === "PENDING" || row.status === "APPROVED" || row.status === undefined);
  const submitted = active.reduce((sum, row) => sum + row.amount, 0);
  const approved = active.filter(row => row.status !== "PENDING").reduce((sum, row) => sum + row.amount, 0);
  return { submitted, approved, percentage: submitted > 0 ? Math.round(approved / submitted * 100) : 0 };
}
