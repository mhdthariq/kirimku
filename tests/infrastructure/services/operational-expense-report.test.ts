import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ group: vi.fn(), list: vi.fn(), count: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { transportExpense: { groupBy: m.group, findMany: m.list, count: m.count } } }));
import { operationalExpenseReport } from "@/infrastructure/services/operational-expense-report";
beforeEach(() => {
  vi.clearAllMocks(); m.list.mockResolvedValue([]); m.count.mockResolvedValue(30);
  m.group.mockResolvedValue([{ type: "ANGKUT", status: "APPROVED", _sum: { amount: 150_000 }, _count: { _all: 1 } }, { type: "ANGKUT", status: "PENDING", _sum: { amount: 50_000 }, _count: { _all: 2 } }, { type: "BBM", status: "APPROVED", _sum: { amount: 100_000 }, _count: { _all: 1 } }]);
});
describe("operational expense finance aggregation", () => {
  it("aggregates expenses directly, so shipment joins cannot duplicate transport costs", async () => {
    const report = await operationalExpenseReport({}, 1);
    expect(report.approvedTotal).toBe(250_000);
    expect(report.pendingTotal).toBe(50_000);
    expect(report.byType.find(row => row.type === "ANGKUT")).toMatchObject({ approved: 150_000, pending: 50_000, count: 3 });
    expect(m.group).toHaveBeenCalledExactlyOnceWith({ by: ["type", "status"], _sum: { amount: true }, _count: { _all: true } });
  });
  it("paginates/filter rows while keeping explicitly labelled company-wide summary totals", async () => {
    const report = await operationalExpenseReport({ type: "ANGKUT", status: "PENDING" }, 2);
    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "ANGKUT", status: "PENDING" }, skip: 25, take: 25 }));
    expect(report.pages).toBe(2);
    expect(report.count).toBe(30);
  });
});
