import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/infrastructure/auth/auth";
import { withProofVisibility } from "@/infrastructure/services/proof-visibility";

vi.mock("@/infrastructure/persistence/db", () => ({ db: {} }));

const user: AuthUser = {
  id: 1, username: "staff", name: "Staff", isOwner: false, isActive: true,
  employeeId: 9, warehouseId: 2, warehouseName: "Depot", partnerId: null, partnerType: null,
  roles: [{ id: 1, slug: "admin-gudang", name: "Admin Gudang" }], permissions: [],
};
const capture = {
  photoUrl: "data:image/jpeg;base64,private-proof", locationLabel: "Private capture address",
  captureLatitude: -6.123456, captureLongitude: 106.123456, captureAccuracy: 3,
  capturedAt: new Date("2026-11-03T01:02:03Z"), timeZone: "Asia/Makassar", mockLocation: true,
};
const record = { id: 12, latitude: -7, longitude: 110, notes: "Planned task", ...capture };

describe("proof response visibility", () => {
  it.each([user, null])("redacts proof and capture metadata without mutating the record for %j", actor => {
    const result = withProofVisibility(actor, record);
    expect(result).toEqual({ id: 12, latitude: -7, longitude: 110, notes: "Planned task", photoUrl: null });
    expect(record).toMatchObject(capture);
  });

  it.each([
    { ...user, permissions: ["proof_photo.view"] },
    { ...user, isOwner: true },
    { ...user, permissions: ["*"] },
  ])("preserves authorized evidence for %j", actor => {
    expect(withProofVisibility(actor, record)).toEqual(record);
  });

  it("does not infer proof permission from other evidence or task permissions", () => {
    const actor = { ...user, permissions: ["pickup.view", "delivery.view", "transport.checkin", "pickup.assign_kurir"] };
    expect(withProofVisibility(actor, record).photoUrl).toBeNull();
  });

  it.each([user, { ...user, permissions: ["proof_photo.view"] }])("keeps absent legacy photos explicitly null for %j", actor => {
    expect(withProofVisibility(actor, { id: 12, latitude: -7, photoUrl: undefined })).toEqual({ id: 12, latitude: -7, photoUrl: null });
  });
});
