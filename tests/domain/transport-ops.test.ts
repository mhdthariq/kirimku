import { describe, expect, it } from "vitest";
import {
  buildReturnCheckpoints,
  canApproveDelivery,
  canApproveReturnTask,
  canAssignDrop,
  canCreateReturnTask,
  canCreateReturnTransport,
  canDrop,
  dropProgress,
  groupByDropCheckpoint,
  isVehicleEmpty,
  normalizeTransportMode,
  returnEndpoints,
  returnTaskStatusForTransport,
  summarizeExpenses,
  validateExpense,
} from "@/domain/transport-ops";

describe("expenses — multi transaction, optional photo", () => {
  it("validates type and amount", () => {
    expect(validateExpense({ type: "BBM", amount: 300000 })).toBeNull();
    expect(validateExpense({ type: "BONGKAR", amount: "80000" })).toBeNull();
    expect(validateExpense({ type: "SOLAR", amount: 1 })).toMatch(/Jenis biaya/);
    expect(validateExpense({ type: "BBM", amount: 0 })).toMatch(/lebih dari 0/);
    expect(validateExpense({ type: "BBM", amount: -5 })).toMatch(/lebih dari 0/);
    expect(validateExpense({ type: "BBM", amount: "" })).toMatch(/wajib/);
    expect(validateExpense({ type: "BBM", amount: "abc" })).toMatch(/wajib/);
  });

  it("the spec example: 3 BBM, 2 Parkir, 2 Makan, 2 Bongkar", () => {
    const s = summarizeExpenses([
      { type: "BBM", amount: 300000 }, { type: "BBM", amount: 250000 }, { type: "BBM", amount: 275000 },
      { type: "PARKIR", amount: 20000 }, { type: "PARKIR", amount: 15000 },
      { type: "MAKAN", amount: 50000 }, { type: "MAKAN", amount: 75000 },
      { type: "BONGKAR", amount: 100000 }, { type: "BONGKAR", amount: 80000 },
    ]);
    expect(s.byType.BBM).toEqual({ count: 3, total: 825000 });
    expect(s.byType.PARKIR).toEqual({ count: 2, total: 35000 });
    expect(s.byType.MAKAN).toEqual({ count: 2, total: 125000 });
    expect(s.byType.BONGKAR).toEqual({ count: 2, total: 180000 });
    expect(s.count).toBe(9);
    expect(s.total).toBe(1165000);
  });

  it("ignores unknown types and handles an empty list", () => {
    expect(summarizeExpenses([{ type: "???", amount: 5 }]).total).toBe(0);
    expect(summarizeExpenses([]).count).toBe(0);
  });
});

describe("multi drop", () => {
  it("normalizes the mode, defaulting to DIRECT", () => {
    expect(normalizeTransportMode("MULTI_DROP")).toBe("MULTI_DROP");
    expect(normalizeTransportMode("anything")).toBe("DIRECT");
    expect(normalizeTransportMode(undefined)).toBe("DIRECT");
  });

  it("assigning a drop checkpoint: MULTI_DROP only, before the resi is unloaded", () => {
    expect(canAssignDrop("MULTI_DROP", "PLANNED", "LOADED")).toBeNull();
    expect(canAssignDrop("MULTI_DROP", "DEPARTED", "AT_DROP_POINT")).toBeNull();
    expect(canAssignDrop("DIRECT", "PLANNED", "LOADED")).toMatch(/bukan MULTI_DROP/);
    expect(canAssignDrop("MULTI_DROP", "ARRIVED", "LOADED")).toMatch(/ARRIVED/);
    expect(canAssignDrop("MULTI_DROP", "DEPARTED", "DROPPED")).toMatch(/DROPPED/);
  });

  it("dropping needs a DEPARTED transport AND a check-in at the drop checkpoint", () => {
    const ok = { mode: "MULTI_DROP" as const, transportStatus: "DEPARTED", dropStatus: "AT_DROP_POINT", vehicleCheckedInAtDrop: true };
    expect(canDrop(ok)).toBeNull();
    expect(canDrop({ ...ok, vehicleCheckedInAtDrop: false })).toMatch(/belum check-in/);
    expect(canDrop({ ...ok, transportStatus: "PLANNED" })).toMatch(/DEPARTED/);
    expect(canDrop({ ...ok, dropStatus: "DROPPED" })).toMatch(/DROPPED/);
    expect(canDrop({ ...ok, mode: "DIRECT" })).toMatch(/bukan MULTI_DROP/);
  });

  it("groups resi by drop checkpoint in route order; no checkpoint = the final one", () => {
    const cps = [{ id: 1, sequence: 1 }, { id: 2, sequence: 2 }, { id: 3, sequence: 3 }, { id: 4, sequence: 4 }];
    const groups = groupByDropCheckpoint(
      [
        { code: "RESI-004", dropCheckpointId: 4 },
        { code: "RESI-001", dropCheckpointId: 2 },
        { code: "RESI-002", dropCheckpointId: 2 },
        { code: "RESI-003", dropCheckpointId: 3 },
        { code: "RESI-005", dropCheckpointId: null },
      ],
      cps,
    );
    expect(groups.map((g) => [g.checkpointId, g.shipments.map((s) => s.code)])).toEqual([
      [2, ["RESI-001", "RESI-002"]],
      [3, ["RESI-003"]],
      [4, ["RESI-004", "RESI-005"]],
    ]);
  });

  it("progress counts loaded / dropped / approved", () => {
    expect(dropProgress([])).toMatchObject({ total: 0, allDropped: false, allApproved: false });
    expect(dropProgress(["LOADED", "DROPPED", "DELIVERY_APPROVED"])).toMatchObject({ total: 3, loaded: 1, dropped: 2, approved: 1, allDropped: false, allApproved: false });
    expect(dropProgress(["DROPPED", "DELIVERY_PENDING"]).allDropped).toBe(true);
    expect(dropProgress(["DELIVERY_APPROVED", "DELIVERY_APPROVED"]).allApproved).toBe(true);
  });
});

describe("delivery approval", () => {
  it("only an unloaded resi can be approved, and only once", () => {
    expect(canApproveDelivery("DROPPED")).toBeNull();
    expect(canApproveDelivery("DELIVERY_PENDING")).toBeNull();
    expect(canApproveDelivery("LOADED")).toMatch(/DROPPED dulu/);
    expect(canApproveDelivery("AT_DROP_POINT")).toMatch(/DROPPED dulu/);
    expect(canApproveDelivery("DELIVERY_APPROVED")).toMatch(/sudah disetujui/);
  });
});

describe("return task", () => {
  it("the vehicle is empty only when EVERY resi is delivery-approved", () => {
    expect(isVehicleEmpty(["DELIVERY_APPROVED", "DELIVERY_APPROVED"])).toBe(true);
    expect(isVehicleEmpty(["DELIVERY_APPROVED", "DROPPED"])).toBe(false);
    expect(isVehicleEmpty([])).toBe(false);
  });

  it("can be created only for an empty vehicle without an active return task", () => {
    expect(canCreateReturnTask({ dropStatuses: ["DELIVERY_APPROVED"], hasActiveReturnTask: false })).toBeNull();
    expect(canCreateReturnTask({ dropStatuses: ["DELIVERY_APPROVED", "DROPPED"], hasActiveReturnTask: false })).toMatch(/belum kosong/);
    expect(canCreateReturnTask({ dropStatuses: ["DELIVERY_APPROVED"], hasActiveReturnTask: true })).toMatch(/sudah ada/);
    expect(canCreateReturnTask({ dropStatuses: [], hasActiveReturnTask: false })).toMatch(/tanpa resi/);
  });

  it("approve → create transport lifecycle guards", () => {
    expect(canApproveReturnTask("CREATED")).toBeNull();
    expect(canApproveReturnTask("APPROVED")).toMatch(/hanya CREATED/);
    expect(canCreateReturnTransport("APPROVED", false)).toBeNull();
    expect(canCreateReturnTransport("CREATED", false)).toMatch(/APPROVED dulu/);
    expect(canCreateReturnTransport("APPROVED", true)).toMatch(/sudah dibuat/);
  });

  it("return route is the outbound one reversed (Medan→Binjai→Stabat→Brandan)", () => {
    const outbound = [
      { name: "Medan", sequence: 1 }, { name: "Binjai", sequence: 2 },
      { name: "Stabat", sequence: 3 }, { name: "Brandan", sequence: 4 },
    ];
    expect(buildReturnCheckpoints(outbound).map((c) => [c.sequence, c.name])).toEqual([
      [1, "Brandan"], [2, "Stabat"], [3, "Binjai"], [4, "Medan"],
    ]);
    expect(returnEndpoints({ origin: "Medan", destination: "Brandan" })).toEqual({ origin: "Brandan", destination: "Medan" });
  });

  it("the return task follows its transport's status", () => {
    expect(returnTaskStatusForTransport("PLANNED")).toBe("PLANNED");
    expect(returnTaskStatusForTransport("DEPARTED")).toBe("DEPARTED");
    expect(returnTaskStatusForTransport("ARRIVED")).toBe("ARRIVED");
    expect(returnTaskStatusForTransport("CANCELLED")).toBeNull();
  });
});
