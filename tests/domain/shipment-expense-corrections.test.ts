import { describe, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/persistence/db", () => ({ db: {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ tenantKey: () => "test" }));
import { expenseProgress } from "@/domain/expense-progress";
import { canEnterShipmentExpense } from "@/domain/shipment-expense";
import { ROLE_TEMPLATES } from "@/infrastructure/auth/rbac";

describe("expense submission and approval amounts", () => {
  it("tracks zero, new BBM, approval, cancellation and later additions independently", () => {
    expect(expenseProgress([])).toEqual({ submitted: 0, approved: 0, percentage: 0 });
    const fuel = { amount: 100_000, status: "PENDING" };
    expect(expenseProgress([fuel])).toEqual({ submitted: 100_000, approved: 0, percentage: 0 });
    fuel.status = "APPROVED";
    expect(expenseProgress([fuel])).toEqual({ submitted: 100_000, approved: 100_000, percentage: 100 });
    expect(expenseProgress([fuel, { amount: 100_000, status: "PENDING" }])).toEqual({ submitted: 200_000, approved: 100_000, percentage: 50 });
    fuel.status = "CANCELLED";
    expect(expenseProgress([fuel])).toEqual({ submitted: 0, approved: 0, percentage: 0 });
  });
});
describe("shipment expense entry", () => {
  const shipment = { customer: { type: "b2b" }, createdByPartnerId: null, status: "RECEIVED_AT_GUDANG", destReceivedAt: null };
  it("permits non-Marketing B2B after origin or confirmed destination receipt", () => {
    expect(canEnterShipmentExpense(shipment)).toBe(true);
    expect(canEnterShipmentExpense({ ...shipment, status: "ARRIVED_AT_GUDANG", destReceivedAt: new Date() })).toBe(true);
  });
  it("rejects B2C, Marketing-created, pending destination scans and pre-arrival", () => {
    expect(canEnterShipmentExpense({ ...shipment, customer: { type: "b2c" } })).toBe(false);
    expect(canEnterShipmentExpense({ ...shipment, createdByPartnerId: 4 })).toBe(false);
    for (const status of ["CREATED", "PICKED_UP", "IN_TRANSPORT", "AT_DEST_GUDANG", "ARRIVED_AT_GUDANG", "DELIVERED", "CANCELLED"]) expect(canEnterShipmentExpense({ ...shipment, status })).toBe(false);
  });
  it("grants entry to Admin Gudang and arrival undo only to Owner by default", () => {
    expect(ROLE_TEMPLATES.find(role => role.slug === "admin-gudang")?.permissions).toContain("shipment.expense.create");
    expect(ROLE_TEMPLATES.filter(role => role.permissions.includes("shipment.undo_arrival")).map(role => role.slug)).toEqual(["owner"]);
  });
});
