import { NextRequest } from "next/server";
import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  auth: vi.fn(), banks: vi.fn(), bankFind: vi.fn(), bankCreate: vi.fn(), bankUpdate: vi.fn(),
  invoiceFind: vi.fn(), invoiceCreate: vi.fn(), invoiceUpdate: vi.fn(), shipment: vi.fn(), expenses: vi.fn(),
  shipmentScope: vi.fn(), transportScope: vi.fn(), audit: vi.fn(), report: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => {
  const db = {
    bankAccount: { findMany: m.banks, findUnique: m.bankFind, create: m.bankCreate, update: m.bankUpdate },
    invoice: { findUnique: m.invoiceFind, create: m.invoiceCreate, update: m.invoiceUpdate },
    masterShipment: { findUnique: m.shipment }, customer: { findUnique: async () => ({ id: 1, name: "Customer", type: "b2b" }) },
    transportExpense: { findMany: m.expenses },
  };
  return { db: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
});
vi.mock("@/infrastructure/auth/auth", () => ({ getAuthUser: m.auth, hasPermission: (user: { permissions: string[] }, permission: string) => user.permissions.includes(permission) }));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ resolveTenantContext: vi.fn(), runWithTenant: (_: unknown, fn: () => unknown) => fn(), isDefaultTenant: () => false }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: m.audit, diffFields: vi.fn() }));
vi.mock("@/infrastructure/services/code-generator", () => ({ nextCode: async () => "INV-TEST" }));
vi.mock("@/infrastructure/services/gudang-scope", () => ({ assertShipmentScope: m.shipmentScope }));
vi.mock("@/infrastructure/services/transport-ops-server", () => ({ assertTransportAccess: m.transportScope }));
vi.mock("@/infrastructure/services/operational-expense-report", () => ({ operationalExpenseReport: m.report, expenseReportSelect: { id: true, amount: true } }));
import { GET as bankList, POST as bankCreate } from "@/app/api/v1/bank-accounts/route";
import { PUT as bankUpdate, DELETE as bankDelete } from "@/app/api/v1/bank-accounts/[id]/route";
import { POST as invoiceCreate } from "@/app/api/v1/invoices/route";
import { PUT as invoiceUpdate } from "@/app/api/v1/invoices/[id]/route";
import { GET as shipmentExpenses } from "@/app/api/v1/shipments/[id]/operational-expenses/route";
import { GET as expenseReport } from "@/app/api/v1/finance/operational-expenses/route";
import { HttpError } from "@/shared/http-error";

const bank = { id: 1, bankName: "BCA", accountNumber: "00123456", accountName: "PT KirimKu", isActive: true };
const snapshot = { bankAccountId: 1, paymentBankName: "BCA", paymentAccountNumber: "00123456", paymentAccountName: "PT KirimKu" };
const params = () => ({ params: Promise.resolve({ id: "1" }) });
const req = (path: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost/api/v1/${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ id: 1, permissions: ["bank_account.view", "bank_account.create", "bank_account.update", "bank_account.delete", "invoice.create", "invoice.update", "shipment.view", "transport.expense.view", "financial.report.view"] });
  m.banks.mockResolvedValue([bank]); m.bankFind.mockResolvedValue(bank); m.bankCreate.mockResolvedValue(bank); m.bankUpdate.mockResolvedValue(bank);
  m.invoiceFind.mockResolvedValue({ id: 1, invoiceNumber: "INV-1", status: "DRAFT", ...snapshot, customerId: 1, lines: [] });
  m.invoiceCreate.mockImplementation(async ({ data }) => ({ id: 1, ...data })); m.invoiceUpdate.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  m.shipment.mockResolvedValue({ id: 1, transportItems: [{ transport: { id: 4 } }, { transport: { id: 4 } }, { transport: { id: 5 } }] });
  m.shipmentScope.mockResolvedValue(undefined); m.transportScope.mockResolvedValue(undefined);
  m.expenses.mockResolvedValue([{ id: 10, amount: 150_000, status: "APPROVED" }, { id: 11, amount: 50_000, status: "PENDING" }]);
  m.report.mockResolvedValue({ approvedTotal: 150_000, pendingTotal: 50_000 });
});

describe("Master Rekening routes", () => {
  it("lets invoice editors read active choices without granting inactive-master access", async () => {
    m.auth.mockResolvedValue({ id: 1, permissions: ["invoice.update"] });
    expect((await bankList(req("bank-accounts"))).status).toBe(200);
    expect(m.banks).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });
  it("keeps account numbers as strings", async () => {
    expect((await bankCreate(req("bank-accounts", "POST", bank))).status).toBe(200);
    expect(m.bankCreate).toHaveBeenCalledWith({ data: { bankName: "BCA", accountNumber: "00123456", accountName: "PT KirimKu", isActive: true } });
  });
  it("soft-deactivates without deleting invoices or account records", async () => {
    expect((await bankDelete(req("bank-accounts/1", "DELETE"), params())).status).toBe(200);
    expect(m.bankUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { isActive: false } });
    expect(m.invoiceUpdate).not.toHaveBeenCalled();
  });
  it("supports reactivating a master", async () => {
    expect((await bankUpdate(req("bank-accounts/1", "PUT", bank), params())).status).toBe(200);
    expect(m.bankUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });
  it.each(["create", "update", "delete"])("requires the specific bank %s permission", async action => {
    m.auth.mockResolvedValue({ id: 1, permissions: ["bank_account.view"] });
    const response = action === "create" ? await bankCreate(req("bank-accounts", "POST", bank)) : action === "update" ? await bankUpdate(req("bank-accounts/1", "PUT", bank), params()) : await bankDelete(req("bank-accounts/1", "DELETE"), params());
    expect(response.status).toBe(403);
  });
});
describe("invoice payment account integration", () => {
  it("takes trusted payment fields from the selected active master", async () => {
    const response = await invoiceCreate(req("invoices", "POST", { customerId: 1, bankAccountId: 1, paymentAccountNumber: "forged", lines: [{ description: "Delivery", quantity: 1, unitPrice: 100_000 }] }));
    expect(response.status).toBe(200);
    expect(m.invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(snapshot) }));
  });
  it("preserves old snapshot fields when another draft field changes", async () => {
    expect((await invoiceUpdate(req("invoices/1", "PUT", { notes: "Changed" }), params())).status).toBe(200);
    expect(m.bankFind).not.toHaveBeenCalled();
    expect(m.invoiceUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { notes: "Changed" } });
  });
  it("preserves an existing selection even if the master was deactivated", async () => {
    m.bankFind.mockResolvedValue({ ...bank, isActive: false });
    expect((await invoiceUpdate(req("invoices/1", "PUT", { bankAccountId: 1 }), params())).status).toBe(200);
    expect(m.bankFind).not.toHaveBeenCalled();
  });
  it("rejects inactive accounts on new invoices before creation", async () => {
    m.bankFind.mockResolvedValue({ ...bank, isActive: false });
    expect((await invoiceCreate(req("invoices", "POST", { customerId: 1, bankAccountId: 1 }))).status).toBe(422);
    expect(m.invoiceCreate).not.toHaveBeenCalled();
  });
});
describe("shared transport expenses on shipments", () => {
  it("deduplicates transport IDs and separates approved from pending", async () => {
    const response = await shipmentExpenses(req("shipments/1/operational-expenses"), params());
    expect(response.status).toBe(200);
    expect(m.expenses).toHaveBeenCalledWith(expect.objectContaining({ where: { transportId: { in: [4, 5] } } }));
    expect((await response.json()).data).toMatchObject({ shared: true, approvedTotal: 150_000, pendingTotal: 50_000 });
  });
  it("excludes inaccessible linked transports", async () => {
    m.transportScope.mockImplementation(async (user, transport) => { if (transport.id === 5) throw new HttpError(403, "Other warehouse"); });
    expect((await shipmentExpenses(req("shipments/1/operational-expenses"), params())).status).toBe(200);
    expect(m.expenses).toHaveBeenCalledWith(expect.objectContaining({ where: { transportId: { in: [4] } } }));
  });
  it("enforces shipment scope before reading costs", async () => {
    m.shipmentScope.mockRejectedValue(new HttpError(403, "Other warehouse"));
    expect((await shipmentExpenses(req("shipments/1/operational-expenses"), params())).status).toBe(403);
    expect(m.expenses).not.toHaveBeenCalled();
  });
  it("does not expose company costs through shipment.view alone", async () => {
    m.auth.mockResolvedValue({ id: 1, permissions: ["shipment.view"] });
    expect((await shipmentExpenses(req("shipments/1/operational-expenses"), params())).status).toBe(403);
    expect(m.shipment).not.toHaveBeenCalled();
  });
});
describe("expense register", () => {
  it("accepts the Biaya Angkut filter", async () => {
    expect((await expenseReport(req("finance/operational-expenses?type=ANGKUT&status=APPROVED&page=2"))).status).toBe(200);
    expect(m.report).toHaveBeenCalledWith({ type: "ANGKUT", status: "APPROVED" }, 2);
  });
  it.each(["type=INVALID", "page=0", "page=1.5", "status=INVALID"])("rejects invalid filter %s", async filter => {
    expect((await expenseReport(req(`finance/operational-expenses?${filter}`))).status).toBe(422);
    expect(m.report).not.toHaveBeenCalled();
  });
  it("requires financial report permission", async () => {
    m.auth.mockResolvedValue({ id: 1, permissions: ["transport.expense.view"] });
    expect((await expenseReport(req("finance/operational-expenses"))).status).toBe(403);
  });
});
