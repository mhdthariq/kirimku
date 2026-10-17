import { describe, expect, it } from "vitest";
import { EXPENSE_LABEL, EXPENSE_TYPES, isExpenseType, summarizeExpenses, validateExpense } from "@/domain/transport-ops";

describe("expense categories", () => {
  it.each(["BONGKAR", "PARKIR", "MAKAN", "BBM", "ANGKUT", "TOL"])("accepts %s with a display label", (type) => {
    expect(EXPENSE_TYPES).toContain(type);
    expect(isExpenseType(type)).toBe(true);
    expect(validateExpense({ type, amount: 25_000 })).toBeNull();
  });

  it("labels toll expenses consistently", () => {
    expect(EXPENSE_LABEL).toHaveProperty("TOL", "Biaya Tol");
  });

  it.each(["tol", "Biaya Tol", "UNKNOWN", "", null, 123])("rejects an invalid category: %s", (type) => {
    expect(isExpenseType(type)).toBe(false);
    expect(validateExpense({ type, amount: 25_000 })).not.toBeNull();
  });

  it.each([0, -1, "", null, "invalid", Infinity])("still rejects invalid toll amounts: %s", (amount) => {
    expect(validateExpense({ type: "TOL", amount })).not.toBeNull();
  });

  it("includes approved tolls in totals but excludes pending and unknown categories", () => {
    const summary = summarizeExpenses([
      { type: "TOL", amount: 25_000, status: "APPROVED" },
      { type: "TOL", amount: 10_000, status: "APPROVED" },
      { type: "TOL", amount: 50_000, status: "PENDING" },
      { type: "BBM", amount: 100_000, status: "APPROVED" },
      { type: "UNKNOWN", amount: 1_000, status: "APPROVED" },
    ]);
    expect(summary.byType).toHaveProperty("TOL", { count: 2, total: 35_000 });
    expect(summary.count).toBe(3);
    expect(summary.total).toBe(135_000);
    expect(summarizeExpenses([]).byType).toHaveProperty("TOL", { count: 0, total: 0 });
  });
});
