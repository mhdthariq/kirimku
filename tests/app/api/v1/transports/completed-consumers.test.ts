import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  guard: vi.fn(), count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(),
  settlementFind: vi.fn(), settlementCreate: vi.fn(), ledgerFind: vi.fn(),
  ledgerCreate: vi.fn(), walletFind: vi.fn(), walletUpdate: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/composition/api-helpers", () => ({
  guard: m.guard,
  handle: (_req: unknown, fn: () => unknown) => fn(),
  ok: (data: unknown) => Response.json({ data }),
  fail: (status: number, message: string) => Response.json({ message }, { status }),
  str: (value: string | null) => value || null,
  num: (value: unknown) => typeof value === "number" ? value : null,
}));
vi.mock("@/infrastructure/persistence/db", () => {
  const summaryModel = { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: {} }) };
  const db = {
    partner: summaryModel, topUpRequest: summaryModel, withdrawalRequest: summaryModel,
    vehicleRepair: summaryModel, marketingCommission: summaryModel, invoiceSettlement: summaryModel,
    transport: { findMany: m.findMany, findUnique: m.findUnique, findFirst: m.findFirst, count: m.count },
    employee: { findMany: vi.fn().mockResolvedValue([]) },
    transportSettlement: { findUnique: m.settlementFind, create: m.settlementCreate, aggregate: summaryModel.aggregate },
    walletTransaction: { findUnique: m.ledgerFind, create: m.ledgerCreate, findMany: summaryModel.findMany },
    wallet: { findUnique: m.walletFind, update: m.walletUpdate },
  };
  return { db: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
});
vi.mock("@/infrastructure/services/wallet", () => ({ financeAudit: m.audit }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: async () => "TST-1" }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: vi.fn() }));
vi.mock("@/infrastructure/services/settings", () => ({ getCapacityWarningThreshold: async () => 0.9 }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({
  scopeForUser: async () => null, cityIndex: async () => new Map(), inScope: () => true,
  transportGudangIds: () => [],
}));
vi.mock("@/infrastructure/services/transport-totals", () => ({
  isExecutorOnly: () => false,
  detailAggregates: async () => ({ volumeByMaster: new Map(), actualKgByMaster: new Map(), packagesByMaster: new Map() }),
}));

import { GET as list } from "@/app/api/v1/transports/route";
import { GET as finance } from "@/app/api/v1/finance/summary/route";
import { GET as dashboard } from "@/app/api/v1/dashboard/driver/route";
import { POST as settle } from "@/app/api/v1/transports/[id]/settle/route";
import { findActiveTransportForVehicle } from "@/infrastructure/services/business-rules/shipment-transport";
import { findActiveCrewAssignment } from "@/infrastructure/services/transport-crew";

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ id: 1, employeeId: 7 });
  m.findMany.mockResolvedValue([]);
  m.count.mockResolvedValue(2);
  m.findFirst.mockResolvedValue(null);
  m.settlementFind.mockResolvedValue(null);
  m.ledgerFind.mockResolvedValue(null);
  m.walletFind.mockResolvedValue({ id: 4, balance: 0 });
  m.ledgerCreate.mockResolvedValue({ id: 5 });
  m.settlementCreate.mockResolvedValue({ id: 6, settlementCode: "TST-1" });
});

function trip(status: string, id = 1) {
  return {
    id, status, transportCode: `TRP-${id}`, trackingMode: "ACTIVITY", arrivedAt: new Date("2026-10-13T12:00:00"),
    vehicleId: 2, vehicle: { vehicleNumber: "BK-1", owner: { id: 3, companyPercent: 20, partnerPercent: 80, user: { name: "Owner" } } },
    shipments: [{ shipmentId: 1, master: { priceAmount: 100 } }], checkpointRecords: [], route: null,
  };
}

describe("COMPLETED transport consumers", () => {
  it("includes completed transports in executor history without broadening employee scope", async () => {
    await list(new NextRequest("http://localhost/api/v1/transports?history=true&mine=true"));
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: { in: ["ARRIVED", "COMPLETED", "CANCELLED"] }, OR: [{ driverId: 7 }, { kenekId: 7 }],
    } }));
  });

  it("keeps arrived trips in driver history but counts only audited completed trips", async () => {
    m.findMany.mockResolvedValue([trip("ARRIVED", 1), trip("COMPLETED", 2), trip("CANCELLED", 3)]);
    const response = await dashboard(new NextRequest("http://localhost/api/v1/dashboard/driver?from=2026-10-13&to=2026-10-13"));
    const { data } = await response.json();
    expect(data.completedCount).toBe(1);
    expect(data.history.map((t: { status: string }) => t.status)).toEqual(["ARRIVED", "COMPLETED"]);
    expect(data.current).toBeNull();
    expect(data.upcoming).toEqual([]);
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ driverId: 7 }, { kenekId: 7 }] } }));
  });

  it.each(["ARRIVED", "COMPLETED"])("allows settlement of %s without changing transport status", async (status) => {
    m.findUnique.mockResolvedValue(trip(status));
    const response = await settle(new NextRequest("http://localhost/api/v1/transports/1/settle", { method: "POST" }), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    expect(m.guard).toHaveBeenCalledWith(expect.anything(), "transport.settle");
    expect(m.settlementCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerAmount: 80, companyAmount: 20, status: "FINALIZED" }) }));
    expect(m.walletUpdate).toHaveBeenCalledWith({ where: { id: 4 }, data: { balance: 80 } });
  });

  it.each(["PLANNED", "DEPARTED", "CANCELLED"])("rejects settlement of %s", async (status) => {
    m.findUnique.mockResolvedValue(trip(status));
    const response = await settle(new NextRequest("http://localhost/api/v1/transports/1/settle", { method: "POST" }), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(422);
    expect(m.settlementCreate).not.toHaveBeenCalled();
    expect(m.walletUpdate).not.toHaveBeenCalled();
  });

  it("counts both arrived and completed partner trips awaiting financial settlement", async () => {
    const response = await finance(new NextRequest("http://localhost/api/v1/finance/summary"));
    expect(response.status).toBe(200);
    expect(m.guard).toHaveBeenCalledWith(expect.anything(), "financial.report.view");
    expect(m.count).toHaveBeenCalledWith({ where: {
      status: { in: ["ARRIVED", "COMPLETED"] }, vehicle: { ownerId: { not: null } }, settlement: null,
    } });
  });

  it("does not reserve vehicles or crew for arrived or completed trips", async () => {
    await findActiveTransportForVehicle(2);
    await findActiveCrewAssignment(7);
    expect(m.findFirst).toHaveBeenCalledTimes(2);
    for (const [query] of m.findFirst.mock.calls) {
      expect(query.where.status.in).toEqual(["PLANNED", "DEPARTED"]);
    }
  });
});
