import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), tenant: vi.fn(), limit: vi.fn() }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: { masterShipment: { findFirst: m.find } } }));
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: vi.fn(), hasPermission: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: m.tenant, runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
vi.mock("@/infrastructure/services/tracking-attempts", () => ({ allowTrackingAttempt: m.limit }));
import { GET, POST } from "@/app/api/v1/public/track/[resi]/route";

const shipment = {
  masterCode: "MKT-1", resi: "RESI-1", status: "CREATED", origin: "Jakarta", destination: "Bandung",
  pengirimPhone: "081234567890", penerimaContact: "089876543210", penerimaAddress: "Jalan Mawar 123",
  customer: { name: "Sender", type: "b2c", phone: "081111111111" }, details: [], trackingEvents: [],
};
function request(phone: unknown, corporateId = "CORP-A") {
  return new NextRequest("http://localhost/api/v1/public/track/MKT-1", { method: "POST", headers: corporateId ? { "x-corp-id": corporateId } : {}, body: JSON.stringify({ phone }) });
}
const params = { params: Promise.resolve({ resi: "MKT-1" }) };
beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue(shipment); m.limit.mockReturnValue(true); });

describe("phone-gated public tracking", () => {
  it("disables the former unverified GET endpoint", async () => {
    expect((await GET()).status).toBe(405);
    expect(m.find).not.toHaveBeenCalled();
  });
  it.each(["081234567890", "+6281234567890", "089876543210"])("allows the complete sender or recipient phone %s", async phone => {
    const response = await POST(request(phone), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { data } = await response.json();
    expect(data.sender.phone).toBe("081234******");
    expect(data.recipient.phone).toBe("089876******");
    expect(data.recipient.address).toBe("Jalan M********");
    expect(data.customer).toBeUndefined();
    expect(m.tenant.mock.calls[0][0].get("x-corp-id")).toBe("CORP-A");
  });
  it("does not accept an unrelated customer master phone when a shipment snapshot exists", async () => {
    expect((await POST(request("081111111111"), params)).status).toBe(403);
  });
  it("uses the printed customer phone fallback for legacy shipments without a sender snapshot", async () => {
    m.find.mockResolvedValue({ ...shipment, pengirimPhone: null });
    expect((await POST(request("081111111111"), params)).status).toBe(200);
  });
  it("requires a corporate ID and a complete phone before lookup", async () => {
    expect((await POST(request("081234567890", ""), params)).status).toBe(422);
    expect((await POST(request("7890"), params)).status).toBe(422);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("gives the same failure for unknown resi and incorrect phone with no shipment data", async () => {
    const wrong = await POST(request("080000000000"), params);
    m.find.mockResolvedValue(null);
    const missing = await POST(request("081234567890"), params);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual(await missing.json());
  });
  it("looks up child codes within the selected company", async () => {
    expect((await POST(request("081234567890"), { params: Promise.resolve({ resi: "CHILD-1" }) })).status).toBe(200);
    expect(m.find.mock.calls[0][0].where.OR).toContainEqual({ details: { some: { detailCode: "CHILD-1" } } });
  });
  it("blocks lookup when verification is rate limited", async () => {
    m.limit.mockReturnValue(false);
    expect((await POST(request("081234567890"), params)).status).toBe(429);
    expect(m.find).not.toHaveBeenCalled();
  });
});
