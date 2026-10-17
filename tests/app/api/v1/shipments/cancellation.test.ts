import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    shipment: vi.fn(),
    invoiceLine: vi.fn(),
    transport: vi.fn(),
    delivery: vi.fn(),
    payments: vi.fn(),
    pickup: vi.fn(),
    employee: vi.fn(),
    warehouses: vi.fn(),
    escrow: vi.fn(),
    update: vi.fn(),
    tracking: vi.fn(),
    transaction: vi.fn(),
    audit: vi.fn(),
    credit: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => ({
    db: {
        masterShipment: { findUnique: mocks.shipment, update: mocks.update },
        invoiceLine: { findFirst: mocks.invoiceLine },
        transportShipment: { findFirst: mocks.transport },
        delivery: { findFirst: mocks.delivery },
        payment: { count: mocks.payments },
        pickup: { findFirst: mocks.pickup },
        employee: { findUnique: mocks.employee },
        warehouse: { findMany: mocks.warehouses },
        walletTransaction: { findUnique: mocks.escrow },
        trackingEvent: { create: mocks.tracking },
        $transaction: mocks.transaction,
    },
}));
vi.mock("@/infrastructure/auth/auth", () => ({
    getAuthUser: mocks.auth,
    hasPermission: (
        user: { isOwner: boolean; permissions: string[] },
        permission: string,
    ) => user.isOwner || user.permissions.includes(permission),
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/audit", () => ({ audit: mocks.audit }));
vi.mock("@/infrastructure/services/wallet", () => ({
    creditWallet: mocks.credit,
}));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
    resolveTenantContext: vi.fn(),
    runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(),
    isDefaultTenant: () => false,
}));

import { db } from "@/infrastructure/persistence/db";
import { POST } from "@/app/api/v1/shipments/[id]/cancel/route";

const user = {
    id: 1,
    name: "Admin",
    isOwner: false,
    permissions: ["shipment.cancel"],
    roles: [],
    employeeId: 2,
};
const shipment = {
    id: 12,
    masterCode: "MS-12",
    status: "CREATED",
    createdByPartnerId: null,
    originWarehouseId: 10,
    destinationWarehouseId: 20,
    arrivedWarehouseId: null,
    origin: "Jakarta",
    destination: "Bandung",
    fulfillmentMode: "WAREHOUSE",
};
const cancel = () =>
    POST(
        new NextRequest("http://localhost/api/v1/shipments/12/cancel", {
            method: "POST",
        }),
        { params: Promise.resolve({ id: "12" }) },
    );
function expectNoSideEffects() {
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.tracking).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.escrow).not.toHaveBeenCalled();
    expect(mocks.credit).not.toHaveBeenCalled();
}
function linkedInvoice(status: string) {
    // Apply the Prisma predicate so CANCELLED coverage also detects a missing filter.
    mocks.invoiceLine.mockImplementation(async ({ where }) =>
        where.shipmentId === shipment.id &&
        status !== where.invoice?.status?.not
            ? { invoice: { invoiceNumber: "INV-12", status } }
            : null,
    );
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(user);
    mocks.shipment.mockResolvedValue(shipment);
    mocks.employee.mockResolvedValue({ warehouseId: 10 });
    mocks.warehouses.mockResolvedValue([]);
    mocks.transport.mockResolvedValue(null);
    mocks.delivery.mockResolvedValue(null);
    mocks.invoiceLine.mockResolvedValue(null);
    mocks.payments.mockResolvedValue(0);
    mocks.pickup.mockResolvedValue(null);
    mocks.escrow.mockResolvedValue(null);
    mocks.update.mockResolvedValue({ ...shipment, status: "CANCELLED" });
    mocks.transaction.mockImplementation((fn) => fn(db));
});

describe("shipment cancellation", () => {
    it.each(["DRAFT", "SENT", "PARTIALLY_SETTLED", "SETTLED", "UNKNOWN"])(
        "blocks linked %s invoices before any side effects",
        async (status) => {
            linkedInvoice(status);
            const response = await cancel();
            expect(response.status).toBe(422);
            expect((await response.json()).message).toBe(
                `Shipment sudah termasuk dalam invoice aktif INV-12 (${status}). Batalkan invoice tersebut terlebih dahulu sebelum membatalkan shipment.`,
            );
            expect(mocks.invoiceLine).toHaveBeenCalledWith({
                where: {
                    shipmentId: 12,
                    invoice: { status: { not: "CANCELLED" } },
                },
                select: {
                    invoice: { select: { invoiceNumber: true, status: true } },
                },
            });
            expectNoSideEffects();
        },
    );

    it.each([null, "CANCELLED"])(
        "allows cancellation with invoice status %s",
        async (status) => {
            if (status) linkedInvoice(status);
            const response = await cancel();
            expect(response.status).toBe(200);
            expect((await response.json()).data.status).toBe("CANCELLED");
            expect(mocks.update).toHaveBeenCalledWith({
                where: { id: 12 },
                data: { status: "CANCELLED" },
            });
            expect(mocks.tracking).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    masterId: 12,
                    event: "CANCELLED",
                    actorId: 1,
                }),
            });
            expect(mocks.audit).toHaveBeenCalledTimes(1);
        },
    );

    it.each(["PLANNED", "DEPARTED"])(
        "preserves the %s transport block even with a cancelled invoice",
        async (status) => {
            linkedInvoice("CANCELLED");
            mocks.transport.mockResolvedValue({
                transport: { transportCode: "TRP-1", status },
            });
            const response = await cancel();
            expect(response.status).toBe(422);
            expect((await response.json()).message).toContain(
                "Hapus shipment dari transport tersebut sebelum membatalkan.",
            );
            expect(mocks.transport).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        shipmentId: 12,
                        transport: { status: { in: ["PLANNED", "DEPARTED"] } },
                    },
                }),
            );
            expectNoSideEffects();
        },
    );

    it.each(["ASSIGNED", "IN_PROGRESS"])(
        "preserves the %s delivery block",
        async (status) => {
            mocks.delivery.mockResolvedValue({ deliveryCode: "DLV-1", status });
            const response = await cancel();
            expect(response.status).toBe(422);
            expect((await response.json()).message).toContain(
                "Batalkan delivery tersebut sebelum membatalkan shipment.",
            );
            expectNoSideEffects();
        },
    );

    it("preserves non-blocking payment and pickup warnings with a cancelled invoice", async () => {
        linkedInvoice("CANCELLED");
        mocks.payments.mockResolvedValue(2);
        mocks.pickup.mockResolvedValue({
            pickupCode: "PKP-1",
            status: "ASSIGNED",
        });
        expect((await cancel()).status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                after: {
                    warnings: [
                        expect.stringContaining("2 pembayaran terverifikasi"),
                        expect.stringContaining("PKP-1"),
                    ],
                },
            }),
        );
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it("preserves escrow refunds for permitted cancellation", async () => {
        linkedInvoice("CANCELLED");
        mocks.shipment.mockResolvedValue({
            ...shipment,
            createdByPartnerId: 7,
        });
        mocks.escrow.mockResolvedValue({ amount: 50000 });
        mocks.credit.mockResolvedValue({ transactionId: 99 });
        expect((await cancel()).status).toBe(200);
        expect(mocks.credit).toHaveBeenCalledWith(
            expect.objectContaining({
                partnerId: 7,
                amount: 50000,
                businessRef: "ESCROW-REFUND-12",
                referenceId: 12,
            }),
        );
    });

    it.each(["DELIVERED", "CANCELLED"])(
        "preserves the terminal %s status guard",
        async (status) => {
            mocks.employee.mockResolvedValue({
                warehouseId: status === "DELIVERED" ? 20 : 10,
            });
            mocks.shipment.mockResolvedValue({ ...shipment, status });
            expect((await cancel()).status).toBe(422);
            expect(mocks.invoiceLine).not.toHaveBeenCalled();
            expectNoSideEffects();
        },
    );

    it.each([
        [null, 401],
        [{ ...user, permissions: [] }, 403],
    ] as const)(
        "requires authentication and cancellation permission (%s)",
        async (actor, expected) => {
            mocks.auth.mockResolvedValue(actor);
            expect((await cancel()).status).toBe(expected);
            expect(mocks.shipment).not.toHaveBeenCalled();
            expect(mocks.invoiceLine).not.toHaveBeenCalled();
            expectNoSideEffects();
        },
    );

    it("returns 404 for a missing shipment", async () => {
        mocks.shipment.mockResolvedValue(null);
        expect((await cancel()).status).toBe(404);
        expect(mocks.invoiceLine).not.toHaveBeenCalled();
        expectNoSideEffects();
    });

    it("denies another warehouse before reading invoice details", async () => {
        mocks.employee.mockResolvedValue({ warehouseId: 30 });
        expect((await cancel()).status).toBe(403);
        expect(mocks.invoiceLine).not.toHaveBeenCalled();
        expectNoSideEffects();
    });

    it("denies another marketing partner's shipment before reading invoice details", async () => {
        mocks.auth.mockResolvedValue({
            ...user,
            partnerType: "MARKETING",
            partnerId: 8,
        });
        mocks.shipment.mockResolvedValue({
            ...shipment,
            createdByPartnerId: 7,
        });
        expect((await cancel()).status).toBe(403);
        expect(mocks.invoiceLine).not.toHaveBeenCalled();
        expectNoSideEffects();
    });

    it("does not let owners bypass the active invoice guard", async () => {
        mocks.auth.mockResolvedValue({
            ...user,
            isOwner: true,
            permissions: [],
        });
        linkedInvoice("DRAFT");
        expect((await cancel()).status).toBe(422);
        expectNoSideEffects();
    });
});
