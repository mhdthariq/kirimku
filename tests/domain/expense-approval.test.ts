import { describe, expect, it } from "vitest";
import { summarizeExpenses, validateExpenseLocation } from "@/domain/transport-ops";

const gps = { latitude: -6.2, longitude: 106.8, locationAccuracy: 5 };
describe("expense GPS and approved totals", () => {
  it.each([
    {}, { ...gps, latitude: null }, { ...gps, latitude: "0" }, { ...gps, latitude: true },
    { ...gps, latitude: NaN }, { ...gps, latitude: Infinity }, { ...gps, latitude: 91 },
    { ...gps, longitude: -181 }, { ...gps, longitude: Infinity }, { ...gps, longitude: null },
    { ...gps, locationAccuracy: -1 }, { ...gps, locationAccuracy: NaN },
    { ...gps, locationAccuracy: null }, { ...gps, locationAccuracy: "5" },
  ])("rejects invalid GPS %#", (input) => expect(validateExpenseLocation(input)).not.toBeNull());
  it.each([gps, { latitude: 0, longitude: 0, locationAccuracy: 0 }, { latitude: -90, longitude: 180, locationAccuracy: 100 }])("accepts finite GPS %#", (input) => {
    expect(validateExpenseLocation(input)).toBeNull();
  });
  it("excludes pending and unknown statuses from totals and counts", () => {
    const summary = summarizeExpenses([
      { type: "BBM", amount: 100, status: "APPROVED" },
      { type: "BBM", amount: 999, status: "PENDING" },
      { type: "MAKAN", amount: 888, status: "REJECTED" },
    ]);
    expect(summary.total).toBe(100);
    expect(summary.count).toBe(1);
    expect(summary.byType.BBM).toEqual({ count: 1, total: 100 });
    expect(summary.byType.MAKAN.count).toBe(0);
  });
});
