import { describe, it, expect } from "vitest";
import {
  isTransportEditable,
  isTransportFinanciallyLocked,
  checkTransportEditable,
  checkTransportFinanciallyEditable,
} from "@/infrastructure/services/business-rules/shipment-transport";
import { countsTowardPaid } from "@/infrastructure/services/business-rules/payment";
import { canTransition } from "@/domain/shipment-flow";

// ---------------------------------------------------------------------------
// Transport lifecycle locks (Phase 2/6)
// ---------------------------------------------------------------------------
describe("Transport lifecycle locks", () => {
  it("only PLANNED is editable", () => {
    expect(isTransportEditable("PLANNED")).toBe(true);
    expect(isTransportEditable("DEPARTED")).toBe(false);
    expect(isTransportEditable("ARRIVED")).toBe(false);
    expect(isTransportEditable("CANCELLED")).toBe(false);
  });

  it("ARRIVED + CANCELLED + settled transports are financially locked", () => {
    expect(isTransportFinanciallyLocked("PLANNED")).toBe(false);
    expect(isTransportFinanciallyLocked("DEPARTED")).toBe(false);
    expect(isTransportFinanciallyLocked("ARRIVED")).toBe(true);
    expect(isTransportFinanciallyLocked("CANCELLED")).toBe(true);
    // settled (non-PENDING settlement status)
    expect(isTransportFinanciallyLocked("DEPARTED", "FINALIZED")).toBe(true);
    expect(isTransportFinanciallyLocked("DEPARTED", "PENDING")).toBe(false);
  });

  it("checkTransportEditable returns error for non-PLANNED", () => {
    expect(checkTransportEditable("PLANNED", "TRP-1")).toBeNull();
    const err = checkTransportEditable("DEPARTED", "TRP-1");
    expect(err).toContain("TRP-1");
    expect(err).toContain("DEPARTED");
  });

  it("checkTransportFinanciallyEditable returns error for locked transports", () => {
    expect(checkTransportFinanciallyEditable("PLANNED", null, "TRP-1")).toBeNull();
    expect(checkTransportFinanciallyEditable("DEPARTED", "PENDING", "TRP-1")).toBeNull();
    const err = checkTransportFinanciallyEditable("ARRIVED", null, "TRP-1");
    expect(err).toContain("sudah tiba");
    const errSettled = checkTransportFinanciallyEditable("DEPARTED", "FINALIZED", "TRP-1");
    expect(errSettled).toContain("di-settle");
  });
});

// ---------------------------------------------------------------------------
// Payment status counting (Phase 8)
// ---------------------------------------------------------------------------
describe("Payment status counting", () => {
  it("only VERIFIED counts toward paid", () => {
    expect(countsTowardPaid("VERIFIED")).toBe(true);
    expect(countsTowardPaid("RECORDED")).toBe(false);
    expect(countsTowardPaid("REJECTED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shipment state machine transitions (Phase 4) — the existing canTransition
// ---------------------------------------------------------------------------
describe("Shipment state machine transitions", () => {
  it("CREATED can transition to READY_FOR_PICKUP, RECEIVED_AT_GUDANG, CANCELLED", () => {
    expect(canTransition("CREATED", "READY_FOR_PICKUP")).toBe(true);
    expect(canTransition("CREATED", "RECEIVED_AT_GUDANG")).toBe(true);
    expect(canTransition("CREATED", "CANCELLED")).toBe(true);
    expect(canTransition("CREATED", "DELIVERED")).toBe(false);
  });

  it("DELIVERED and CANCELLED are terminal (no transitions)", () => {
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "DELIVERED")).toBe(false);
    expect(canTransition("DELIVERED", "ARRIVED_AT_GUDANG")).toBe(false);
  });

  it("IN_TRANSPORT can transition to AT_DEST_GUDANG, ARRIVED_AT_GUDANG, CANCELLED", () => {
    expect(canTransition("IN_TRANSPORT", "AT_DEST_GUDANG")).toBe(true);
    expect(canTransition("IN_TRANSPORT", "ARRIVED_AT_GUDANG")).toBe(true);
    expect(canTransition("IN_TRANSPORT", "CANCELLED")).toBe(true);
  });

  it("RECEIVED_AT_GUDANG can transition to IN_TRANSPORT or CANCELLED only", () => {
    expect(canTransition("RECEIVED_AT_GUDANG", "IN_TRANSPORT")).toBe(true);
    expect(canTransition("RECEIVED_AT_GUDANG", "CANCELLED")).toBe(true);
    expect(canTransition("RECEIVED_AT_GUDANG", "DELIVERED")).toBe(false);
  });
});
