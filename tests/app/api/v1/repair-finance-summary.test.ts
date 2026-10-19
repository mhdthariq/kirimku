import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ repairs: vi.fn(), deductions: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => {
  const empty = async () => [];
  const aggregate = async () => ({ _sum: {} });
  return { db: {
    partner: { findMany: empty },
    payment: { groupBy: empty, aggregate },
    invoice: { findMany: empty },
    topUpRequest: { findMany: empty, aggregate },
    withdrawalRequest: { findMany: empty, aggregate },
    vehicleRepair: { findMany: m.repairs, aggregate: m.deductions },
    marketingCommission: { findMany: empty, aggregate },
    transportSettlement: { aggregate },
    invoiceSettlement: { findMany: empty, aggregate },
    transport: { count: async () => 0 },
    walletTransaction: { findMany: empty },
  } };
});
vi.mock("@/composition/api-helpers", async (original) => ({
  ...await original<typeof import("@/composition/api-helpers")>(),
  guard: async () => ({ id: 1 }),
  handle: (_: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
import { GET } from "@/app/api/v1/finance/summary/route";

beforeEach(() => {
  vi.resetAllMocks();
  m.repairs.mockResolvedValue([
    { id: 1, owner: null, vehicle: { vehicleNumber: "B 1000 CO" }, amount: 500 },
    { id: 2, owner: { user: { name: "Partner" } }, vehicle: { vehicleNumber: "B 2000 PA" }, amount: 100 },
  ]);
  m.deductions.mockResolvedValue({ _sum: { deductedAmount: 100 } });
});

it("reports only actual partner deductions and safely labels company repair activity", async () => {
  const response = await GET(new NextRequest("http://localhost/api/v1/finance/summary"));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.totals.repairDeductions).toBe(100);
  expect(m.deductions).toHaveBeenCalledWith({
    where: { status: "VERIFIED", ownerId: { not: null } }, _sum: { deductedAmount: true },
  });
  expect(data.pending.repairs).toEqual([
    expect.objectContaining({ id: 1, ownerName: "Perusahaan", amount: 500 }),
    expect.objectContaining({ id: 2, ownerName: "Partner", amount: 100 }),
  ]);
});

it("reports zero deductions when only company repairs exist", async () => {
  m.deductions.mockResolvedValue({ _sum: { deductedAmount: null } });
  const { data } = await (await GET(new NextRequest("http://localhost/api/v1/finance/summary"))).json();
  expect(data.totals.repairDeductions).toBe(0);
});
