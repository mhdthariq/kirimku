import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  shipment: vi.fn(), arrived: vi.fn(), billed: vi.fn(), create: vi.fn(), invoiceCreate: vi.fn(), invoiceUpdate: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  invoice: {
    findUnique: vi.fn(async () => ({ id: 1, customerId: 2, status: "DRAFT", invoiceNumber: "INV-1", lines: [] })),
    create: m.invoiceCreate, update: m.invoiceUpdate,
  },
  customer: { findUnique: vi.fn(async () => ({ id: 2, name: "Company", type: "b2b" })) },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ invoiceLine: { deleteMany: vi.fn() }, invoice: { update: m.invoiceUpdate } }),
  masterShipment: { findUnique: m.shipment },
  transportShipment: { findFirst: m.arrived },
  invoiceLine: { findFirst: m.billed, create: m.create },
} }));
vi.mock("@/composition/api-helpers", () => ({
  guard: vi.fn(async () => ({ id: 1 })),
  handle: (_req: unknown, fn: () => unknown) => fn(),
  ok: (data: unknown) => Response.json(data),
  fail: (status: number, message: string) => Response.json({ message }, { status }),
  num: (v: unknown) => v == null ? null : Number(v),
  requireStr: (v: unknown) => String(v),
  str: (v: unknown) => typeof v === "string" ? v : null,
  dateOrNull: () => null,
}));
vi.mock("@/infrastructure/services/audit", () => ({ audit: vi.fn(), diffFields: vi.fn() }));
vi.mock("@/infrastructure/services/invoice-bank-account", () => ({ invoiceBankSnapshot: vi.fn(async () => ({})) }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: vi.fn(async () => "INV-1") }));
import { POST } from "@/app/api/v1/invoices/[id]/lines/route";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { PUT as updateInvoice } from "@/app/api/v1/invoices/[id]/route";
function addLine() {
  return POST(new NextRequest("http://localhost/api/v1/invoices/1/lines", { method: "POST", body: JSON.stringify({ description: "Shipment", quantity: 1, unitPrice: 100, shipmentId: 3 }) }), { params: Promise.resolve({ id: "1" }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.shipment.mockResolvedValue({ id: 3, customerId: 2, masterCode: "S-3", status: "IN_TRANSIT" });
  m.arrived.mockResolvedValue(null);
  m.billed.mockResolvedValue(null);
  m.create.mockResolvedValue({ id: 4 });
  m.invoiceCreate.mockResolvedValue({ id: 1, invoiceNumber: "INV-1" });
  m.invoiceUpdate.mockResolvedValue({ id: 1, invoiceNumber: "INV-1" });
});
describe("shipment invoice arrival gate", () => {
  it("rejects shipments without an arrived transport", async () => {
    expect((await addLine()).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("allows shipments on arrived or completed transports", async () => {
    m.arrived.mockResolvedValue({ transportId: 5 });
    expect((await addLine()).status).toBe(200);
    expect(m.arrived).toHaveBeenCalledWith({ where: { shipmentId: 3, transport: { status: { in: ["ARRIVED", "COMPLETED"] } } } });
    expect(m.create).toHaveBeenCalled();
  });
  it("rejects cancelled shipments even after transport arrival", async () => {
    m.arrived.mockResolvedValue({ transportId: 5 });
    m.shipment.mockResolvedValue({ id: 3, customerId: 2, status: "CANCELLED" });
    expect((await addLine()).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects an already billed shipment after arrival", async () => {
    m.arrived.mockResolvedValue({ transportId: 5 });
    m.billed.mockResolvedValue({ invoice: { invoiceNumber: "INV-2" } });
    expect((await addLine()).status).toBe(422);
    expect(m.create).not.toHaveBeenCalled();
  });
});


for (const [operation, route] of [["create", createInvoice], ["update", updateInvoice]] as const) {
  describe(`invoice ${operation} shipment validation`, () => {
    function submit() {
      return route(new NextRequest("http://localhost/api/v1/invoices/1", {
        method: operation === "create" ? "POST" : "PUT",
        body: JSON.stringify({ customerId: 2, lines: [{ description: "Shipment", quantity: 1, unitPrice: 100, shipmentId: 3 }] }),
      }), { params: Promise.resolve({ id: "1" }) });
    }
    it("rejects shipments with no arrived transport before writing an invoice", async () => {
      expect((await submit()).status).toBe(422);
      expect(m.invoiceCreate).not.toHaveBeenCalled();
      expect(m.invoiceUpdate).not.toHaveBeenCalled();
    });
    it("accepts shipments after transport arrival", async () => {
      m.arrived.mockResolvedValue({ transportId: 5 });
      expect((await submit()).status).toBe(200);
      expect(operation === "create" ? m.invoiceCreate : m.invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lines: { create: [expect.objectContaining({ shipmentId: 3 })] } }),
      }));
    });
    it("rejects a shipment billed on another invoice", async () => {
      m.arrived.mockResolvedValue({ transportId: 5 });
      m.billed.mockResolvedValue({ invoice: { invoiceNumber: "INV-2" } });
      expect((await submit()).status).toBe(422);
      expect(m.invoiceCreate).not.toHaveBeenCalled();
      expect(m.invoiceUpdate).not.toHaveBeenCalled();
    });
    it("rejects cancelled shipments even if their transport has arrived", async () => {
      m.arrived.mockResolvedValue({ transportId: 5 });
      m.shipment.mockResolvedValue({ id: 3, customerId: 2, status: "CANCELLED" });
      expect((await submit()).status).toBe(422);
    });
  });
}
