import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
    auth: vi.fn(),
    permission: vi.fn(),
    scope: vi.fn(),
    transport: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    audit: vi.fn(),
    sync: vi.fn(),
    cityIndex: vi.fn(),
    warehouses: vi.fn(),
    shipmentUpdate: vi.fn(),
    shipmentUpdateMany: vi.fn(),
    dropUpdate: vi.fn(),
    event: vi.fn(),
    deliveryFind: vi.fn(),
    deliveryCreate: vi.fn(),
    route: vi.fn(),
    vehicle: vi.fn(),
    activityCount: vi.fn(),
    checkpointCount: vi.fn(),
    shipmentFind: vi.fn(),
    transportCreate: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/db", () => {
    const db = {
        transport: {
            findUnique: m.transport,
            updateMany: m.updateMany,
            update: m.update,
            create: m.transportCreate,
        },
        transportActivity: {
            findMany: m.list,
            create: m.create,
            count: m.activityCount,
        },
        checkpointRecord: { count: m.checkpointCount },
        route: { findUnique: m.route },
        vehicle: { findUnique: m.vehicle },
        warehouse: { findMany: m.warehouses },
        masterShipment: { update: m.shipmentUpdate, findMany: m.shipmentFind },
        transportShipment: { updateMany: m.shipmentUpdateMany, update: m.dropUpdate },
        trackingEvent: { create: m.event },
        delivery: { findFirst: m.deliveryFind, create: m.deliveryCreate },
    };
    return {
        db: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) },
    };
});
vi.mock("@/infrastructure/auth/auth", () => ({
    getAuthUser: m.auth,
    hasPermission: m.permission,
}));
vi.mock("@/infrastructure/auth/rbac", () => ({ ensureRbac: vi.fn() }));
vi.mock("@/infrastructure/services/seed", () => ({ ensureSeed: vi.fn() }));
vi.mock("@/infrastructure/services/transport-crew", () => ({
    findActiveCrewAssignment: vi.fn().mockResolvedValue(null),
    crewAssignmentMessage: vi.fn(),
}));
vi.mock("@/infrastructure/services/business-rules/shipment-transport", () => ({
    checkVehicleAvailable: vi.fn().mockResolvedValue(null),
    checkShipmentNotOnActiveTransport: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/infrastructure/services/audit", () => ({
    audit: m.audit,
    diffFields: vi.fn().mockReturnValue({}),
}));
vi.mock("@/infrastructure/services/code-generator", () => ({
    nextCode: vi.fn().mockResolvedValue("DLV-1"),
}));
vi.mock("@/infrastructure/services/gudang-scope", () => ({
    assertTransportScope: m.scope,
    cityIndex: m.cityIndex,
    shipmentDestinationGudangIds: () => [2],
}));
vi.mock("@/infrastructure/services/transport-ops-server", async (original) => ({
    ...(await original<
        typeof import("@/infrastructure/services/transport-ops-server")
    >()),
    syncReturnTaskForTransport: m.sync,
}));
vi.mock("@/infrastructure/http/license", () => ({
    LicenseError: class extends Error {},
}));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
    resolveTenantContext: vi.fn(),
    runWithTenant: (_tenant: unknown, fn: () => unknown) => fn(),
    isDefaultTenant: () => false,
}));

import { GET, POST } from "@/app/api/v1/transports/[id]/activities/route";
import { POST as depart } from "@/app/api/v1/transports/[id]/depart/route";
import { POST as undoArrival } from "@/app/api/v1/transports/[id]/undo-arrival/route";
import { POST as arrive } from "@/app/api/v1/transports/[id]/arrive/route";
import { POST as checkin } from "@/app/api/v1/transports/[id]/checkins/route";
import { PUT as edit } from "@/app/api/v1/transports/[id]/route";
import { POST as drop } from "@/app/api/v1/transports/[id]/drops/[shipmentId]/route";
import { POST as plan } from "@/app/api/v1/transports/route";
import { HttpError } from "@/shared/http-error";
import {
    activityCaptureError,
    parseTrackingMode,
} from "@/shared/activity-tracking";

const actor = {
    id: 7,
    username: "driver.andi",
    employeeId: 8,
    isOwner: false,
    roles: [{ slug: "driver" }],
    permissions: [],
};
const transport = {
    id: 10,
    transportCode: "TR-10",
    trackingMode: "ACTIVITY",
    transportMode: "DIRECT",
    status: "PLANNED",
    driverId: 8,
    kenekId: 9,
    routeId: 1,
    route: { name: "A-B", origin: "A", destination: "B", checkpoints: [] },
    plannedDepartureAt: new Date(),
    plannedArrivalAt: new Date(),
    checkpointRecords: [],
    shipments: [
        {
            shipmentId: 20,
            dropStatus: "LOADED",
            master: { status: "IN_TRANSPORT", fulfillmentMode: "STANDARD" },
        },
    ],
};
const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
const payload = () => ({
    photo,
    latitude: -6.2,
    longitude: 106.8,
    locationAccuracy: 5,
    capturedAt: new Date().toISOString(),
});
const params = () => ({ params: Promise.resolve({ id: "10" }) });
const req = (body: unknown = payload()) =>
    new NextRequest("http://localhost/api/v1/transports/10/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

beforeEach(() => {
    vi.resetAllMocks();
    m.auth.mockResolvedValue(actor);
    m.permission.mockReturnValue(true);
    m.transport.mockResolvedValue(transport);
    m.updateMany.mockResolvedValue({ count: 1 });
    m.create.mockResolvedValue({ id: 30 });
    m.update.mockResolvedValue({ id: 10 });
    m.activityCount.mockResolvedValue(0);
    m.checkpointCount.mockResolvedValue(0);
    m.shipmentFind.mockResolvedValue([]);
    m.transportCreate.mockResolvedValue({ id: 10 });
    m.list.mockResolvedValue([{ id: 30, photoUrl: photo }]);
    m.warehouses.mockResolvedValue([]);
    m.cityIndex.mockResolvedValue(new Map());
});

describe("activity evidence API", () => {
    it("stores trusted actor snapshots, GPS and capture time without changing lifecycle", async () => {
        const body = {
            ...payload(),
            recordedById: 999,
            recordedByUsername: "forged",
            status: "ARRIVED",
        };
        expect((await POST(req(body), params())).status).toBe(200);
        expect(m.create).toHaveBeenCalledWith({
            data: {
                transportId: 10,
                photoUrl: photo,
                latitude: -6.2,
                longitude: 106.8,
                locationAccuracy: 5,
                capturedAt: new Date(body.capturedAt),
                recordedById: 7,
                recordedByUsername: actor.username,
            },
        });
        expect(m.update).not.toHaveBeenCalled();
        expect(m.sync).not.toHaveBeenCalled();
        expect(m.updateMany).toHaveBeenLastCalledWith(
            expect.objectContaining({
                data: {
                    currentLatitude: -6.2,
                    currentLongitude: 106.8,
                    lastLocationAt: new Date(body.capturedAt),
                },
            }),
        );
        expect(m.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: "activity",
                after: expect.objectContaining({
                    hasPhoto: true,
                    activityId: 30,
                }),
            }),
        );
        expect(m.audit.mock.calls[0][0].after.photoUrl).toBeUndefined();
    });
    it.each(["PLANNED", "DEPARTED"])(
        "accepts evidence while %s",
        async (status) => {
            m.transport.mockResolvedValue({ ...transport, status });
            expect((await POST(req(), params())).status).toBe(200);
        },
    );
    it("accepts assigned kenek and optional accuracy", async () => {
        m.auth.mockResolvedValue({
            ...actor,
            employeeId: 9,
            roles: [{ slug: "kenek" }],
        });
        expect(
            (
                await POST(
                    req({ ...payload(), locationAccuracy: undefined }),
                    params(),
                )
            ).status,
        ).toBe(200);
        expect(m.create.mock.calls[0][0].data.locationAccuracy).toBeNull();
    });
    it.each([401, 403])(
        "enforces authentication/permission (%s)",
        async (status) => {
            if (status === 401) m.auth.mockResolvedValue(null);
            else m.permission.mockReturnValue(false);
            expect((await POST(req(), params())).status).toBe(status);
            expect(m.transport).not.toHaveBeenCalled();
        },
    );
    it("uses view permission and returns newest-first evidence", async () => {
        const response = await GET(req(), params());
        expect(response.status).toBe(200);
        expect(m.permission).toHaveBeenCalledWith(actor, "transport.view");
        expect(m.list).toHaveBeenCalledWith({
            where: { transportId: 10 },
            orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
        });
        expect((await response.json()).data).toEqual([
            { id: 30, photoUrl: photo },
        ]);
    });
    it.each([GET, POST])("blocks unassigned crew %#", async (route) => {
        m.auth.mockResolvedValue({ ...actor, employeeId: 99 });
        expect((await route(req(), params())).status).toBe(403);
        expect(m.create).not.toHaveBeenCalled();
        expect(m.list).not.toHaveBeenCalled();
    });
    it("requires assignment even for owner writes", async () => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true, employeeId: null });
        expect((await POST(req(), params())).status).toBe(403);
    });
    it.each([GET, POST])(
        "enforces warehouse scope for non-crew %#",
        async (route) => {
            m.auth.mockResolvedValue({
                ...actor,
                roles: [{ slug: "admin-gudang" }],
            });
            m.scope.mockRejectedValue(new HttpError(403, "Outside scope"));
            expect((await route(req(), params())).status).toBe(403);
        },
    );
    it.each(["ARRIVED", "CANCELLED"])(
        "rejects evidence for %s",
        async (status) => {
            m.transport.mockResolvedValue({ ...transport, status });
            expect((await POST(req(), params())).status).toBe(422);
            expect(m.create).not.toHaveBeenCalled();
        },
    );
    it.each([GET, POST])("rejects checkpoint mode %#", async (route) => {
        m.transport.mockResolvedValue({
            ...transport,
            trackingMode: "CHECKPOINT",
        });
        expect((await route(req(), params())).status).toBe(422);
    });
    it("accepts ACTIVITY+MULTI_DROP with the same transaction-time assignment guards", async () => {
        m.transport.mockResolvedValue({
            ...transport,
            transportMode: "MULTI_DROP",
        });
        expect((await POST(req(), params())).status).toBe(200);
        expect(m.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    trackingMode: "ACTIVITY",
                    transportMode: "MULTI_DROP",
                    OR: [{ driverId: 8 }, { kenekId: 8 }],
                }),
            }),
        );
    });
    it("rejects missing, coerced or out-of-range GPS and stale/future captures", async () => {
        for (const patch of [
            { latitude: null },
            { latitude: "-6.2" },
            { latitude: 91 },
            { longitude: 181 },
            { longitude: undefined },
            { locationAccuracy: -1 },
            { locationAccuracy: "5" },
            { capturedAt: undefined },
            { capturedAt: "invalid" },
            { capturedAt: new Date(Date.now() - 301_000).toISOString() },
            { capturedAt: new Date(Date.now() + 31_000).toISOString() },
        ]) {
            expect(
                (await POST(req({ ...payload(), ...patch }), params())).status,
            ).toBe(422);
        }
        expect((await POST(req(null), params())).status).toBe(422);
        expect(m.create).not.toHaveBeenCalled();
    });
    it("rejects absent, oversized and malformed/non-image photo payloads", async () => {
        for (const value of [
            undefined,
            "",
            "https://example.com/photo.jpg",
            "data:image/svg+xml;base64,YQ==",
            "data:image/png;base64,YQ==",
            "data:image/jpeg;base64,!!!",
            "data:image/png;base64," + "a".repeat(2_500_000),
        ]) {
            expect(
                (await POST(req({ ...payload(), photo: value }), params()))
                    .status,
            ).toBe(422);
        }
        expect(m.create).not.toHaveBeenCalled();
    });
    it("rejects concurrent lifecycle/mode/assignment changes without an audit", async () => {
        m.updateMany.mockResolvedValue({ count: 0 });
        expect((await POST(req(), params())).status).toBe(409);
        expect(m.create).not.toHaveBeenCalled();
        expect(m.audit).not.toHaveBeenCalled();
    });
    it.each([GET, POST])(
        "returns 404 for missing transports %#",
        async (route) => {
            m.transport.mockResolvedValue(null);
            expect((await route(req(), params())).status).toBe(404);
        },
    );
});

describe("checkpoint-free lifecycle", () => {
    it.each([depart, arrive])(
        "rejects concurrent lifecycle changes %#",
        async (route) => {
            m.transport.mockResolvedValue({
                ...transport,
                status: route === arrive ? "DEPARTED" : "PLANNED",
            });
            m.updateMany.mockResolvedValue({ count: 0 });
            expect((await route(req(), params())).status).toBe(409);
            expect(m.update).not.toHaveBeenCalled();
            expect(m.audit).not.toHaveBeenCalled();
            expect(m.event).not.toHaveBeenCalled();
        },
    );
    it("departs an assigned ACTIVITY transport with no checkpoints", async () => {
        expect((await depart(req(), params())).status).toBe(200);
        expect(m.update).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { status: "DEPARTED", departedAt: expect.any(Date) },
        });
        expect(m.sync).toHaveBeenCalled();
    });
    it("still requires a first checkpoint for CHECKPOINT mode", async () => {
        m.transport.mockResolvedValue({
            ...transport,
            trackingMode: "CHECKPOINT",
        });
        expect((await depart(req(), params())).status).toBe(422);
        expect(m.update).not.toHaveBeenCalled();
    });
    it.each([depart, arrive])(
        "blocks unrelated drivers from lifecycle changes %#",
        async (route) => {
            m.auth.mockResolvedValue({ ...actor, employeeId: 99 });
            expect((await route(req(), params())).status).toBe(403);
            expect(m.update).not.toHaveBeenCalled();
        },
    );
    it("does not allow activity arrival to bypass departure", async () => {
        expect((await arrive(req(), params())).status).toBe(422);
        expect(m.update).not.toHaveBeenCalled();
    });
    it("arrives a departed activity transport and preserves warehouse receipt workflow", async () => {
        m.transport.mockResolvedValue({ ...transport, status: "DEPARTED" });
        expect((await arrive(req(), params())).status).toBe(200);
        expect(m.shipmentUpdate).toHaveBeenCalledWith({
            where: { id: 20 },
            data: {
                status: "AT_DEST_GUDANG",
                arrivedWarehouseId: 2,
                destReceivedAt: null,
            },
        });
    });
    it("creates a DIRECT delivery task on activity arrival", async () => {
        m.transport.mockResolvedValue({
            ...transport,
            status: "DEPARTED",
            shipments: [
                {
                    ...transport.shipments[0],
                    master: {
                        ...transport.shipments[0].master,
                        fulfillmentMode: "DIRECT",
                    },
                },
            ],
        });
        expect((await arrive(req(), params())).status).toBe(200);
        expect(m.deliveryCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                masterId: 20,
                kurirId: 8,
                status: "ASSIGNED",
            }),
        });
        expect(m.shipmentUpdate).toHaveBeenCalledWith({
            where: { id: 20 },
            data: expect.objectContaining({
                status: "ARRIVED_AT_GUDANG",
                destReceivedAt: expect.any(Date),
            }),
        });
        expect(m.deliveryCreate.mock.calls[0][0].data.notes).not.toMatch(
            /checkpoint/i,
        );
        expect(m.event).toHaveBeenCalledWith({
            data: expect.objectContaining({
                masterId: 20,
                event: "ARRIVED_AT_GUDANG",
                description: "Transport TR-10 tiba di tujuan",
            }),
        });
        expect(m.shipmentUpdateMany).toHaveBeenCalledWith({
            where: {
                transportId: 10,
                dropStatus: { in: ["LOADED", "AT_DROP_POINT"] },
            },
            data: {
                dropStatus: "DROPPED",
                droppedAt: expect.any(Date),
                droppedById: actor.id,
            },
        });
    });
    it("reuses an existing DIRECT delivery task on checkpoint-free arrival", async () => {
        m.transport.mockResolvedValue({
            ...transport,
            status: "DEPARTED",
            shipments: [
                {
                    ...transport.shipments[0],
                    master: {
                        ...transport.shipments[0].master,
                        fulfillmentMode: "DIRECT",
                    },
                },
            ],
        });
        m.deliveryFind.mockResolvedValue({ id: 42 });
        expect((await arrive(req(), params())).status).toBe(200);
        expect(m.deliveryFind).toHaveBeenCalledWith({
            where: { masterId: 20 },
            select: { id: true },
        });
        expect(m.deliveryCreate).not.toHaveBeenCalled();
    });
    it("rejects checkpoint check-ins for activity transports", async () => {
        expect((await checkin(req(), params())).status).toBe(422);
        expect(m.update).not.toHaveBeenCalled();
    });
});

describe("checkpoint-free MultiDrop unloading", () => {
    const dropParams = () => ({
        params: Promise.resolve({ id: "10", shipmentId: "20" }),
    });
    const multi = () => ({
        ...transport,
        status: "DEPARTED",
        transportMode: "MULTI_DROP",
        shipments: [
            {
                shipmentId: 20,
                dropStatus: "LOADED",
                dropCheckpointId: null,
                master: {
                    id: 20,
                    status: "IN_TRANSPORT",
                    fulfillmentMode: "STANDARD",
                    destination: "B",
                },
            },
        ],
    });

    it("unloads one ACTIVITY resi without checkpoints, retaining warehouse receipt and approval", async () => {
        m.transport.mockResolvedValue(multi());
        const response = await drop(req({ action: "DROP" }), dropParams());
        expect(response.status).toBe(200);
        expect(m.dropUpdate).toHaveBeenCalledWith({
            where: {
                transportId_shipmentId: { transportId: 10, shipmentId: 20 },
            },
            data: {
                dropStatus: "DROPPED",
                droppedAt: expect.any(Date),
                droppedById: 7,
            },
        });
        expect(m.shipmentUpdate).toHaveBeenCalledWith({
            where: { id: 20 },
            data: {
                status: "AT_DEST_GUDANG",
                arrivedWarehouseId: 2,
                destReceivedAt: null,
            },
        });
        expect(m.shipmentUpdateMany).not.toHaveBeenCalled();
        expect(m.event).toHaveBeenCalledWith({
            data: expect.objectContaining({
                event: "AT_DEST_GUDANG",
                description: expect.stringContaining("tujuan resi B"),
            }),
        });
    });
    it("retains the check-in prerequisite for checkpoint MultiDrop", async () => {
        const t = { ...multi(), trackingMode: "CHECKPOINT", route: { checkpoints: [{ id: 1, sequence: 1 }, { id: 2, sequence: 2 }] } };
        m.transport.mockResolvedValue(t);
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(422);
        expect(m.dropUpdate).not.toHaveBeenCalled();
        m.transport.mockResolvedValue({ ...t, checkpointRecords: [{ checkpointId: 2 }] });
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(200);
    });
    it("creates a delivery task for DIRECT fulfillment without requiring checkpoints", async () => {
        const t = multi();
        t.shipments[0].master.fulfillmentMode = "DIRECT";
        m.transport.mockResolvedValue(t);
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(
            200,
        );
        expect(m.deliveryCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                masterId: 20,
                kurirId: 8,
                status: "ASSIGNED",
            }),
        });
    });
    it("keeps checkpoint tracking dependent on an assigned checkpoint", async () => {
        m.transport.mockResolvedValue({
            ...multi(),
            trackingMode: "CHECKPOINT",
        });
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(
            422,
        );
        expect(m.dropUpdate).not.toHaveBeenCalled();
    });
    it.each(["PLANNED", "ARRIVED", "COMPLETED"])(
        "rejects activity drops while %s",
        async (status) => {
            m.transport.mockResolvedValue({ ...multi(), status });
            expect(
                (await drop(req({ action: "DROP" }), dropParams())).status,
            ).toBe(422);
            expect(m.dropUpdate).not.toHaveBeenCalled();
        },
    );
    it("rejects repeat drops and checkpoint assignment in activity mode", async () => {
        const t = multi();
        t.shipments[0].dropStatus = "DROPPED";
        m.transport.mockResolvedValue(t);
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(
            422,
        );
        expect(
            (
                await drop(
                    req({ action: "ASSIGN", dropCheckpointId: 1 }),
                    dropParams(),
                )
            ).status,
        ).toBe(422);
        expect(m.dropUpdate).not.toHaveBeenCalled();
    });
    it("does not allow unrelated drivers to unload", async () => {
        m.transport.mockResolvedValue(multi());
        m.auth.mockResolvedValue({ ...actor, employeeId: 99 });
        expect((await drop(req({ action: "DROP" }), dropParams())).status).toBe(
            403,
        );
        expect(m.dropUpdate).not.toHaveBeenCalled();
    });
});

describe("planning mode and freshness boundaries", () => {
    it("persists ACTIVITY separately from transport mode when planning", async () => {
        m.route.mockResolvedValue({ ...transport.route });
        m.vehicle.mockResolvedValue({ status: "ACTIVE", vehicleNumber: "B-1" });
        const response = await plan(
            req({
                trackingMode: "ACTIVITY",
                routeId: 1,
                vehicleId: 2,
                plannedDepartureAt: new Date().toISOString(),
                plannedArrivalAt: new Date().toISOString(),
            }),
        );
        expect(response.status).toBe(200);
        expect(m.transportCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                trackingMode: "ACTIVITY",
                transportMode: "DIRECT",
            }),
        });
    });
    it("creates a checkpoint-free ACTIVITY MultiDrop plan", async () => {
        m.route.mockResolvedValue(transport.route);
        m.vehicle.mockResolvedValue({
            status: "ACTIVE",
            vehicleNumber: "BK-1",
        });
        expect(
            (
                await plan(
                    req({
                        routeId: 1,
                        vehicleId: 2,
                        trackingMode: "ACTIVITY",
                        transportMode: "MULTI_DROP",
                        plannedDepartureAt: "2026-10-17T08:00:00Z",
                        plannedArrivalAt: "2026-10-17T09:00:00Z",
                    }),
                )
            ).status,
        ).toBe(200);
        expect(m.transportCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                trackingMode: "ACTIVITY",
                transportMode: "MULTI_DROP",
            }),
        });
    });
    it("updates an activity plan without requiring checkpoints", async () => {
        m.route.mockResolvedValue(transport.route);
        expect(
            (await edit(req({ trackingMode: "ACTIVITY" }), params())).status,
        ).toBe(200);
        expect(m.update).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { trackingMode: "ACTIVITY", transportMode: "DIRECT" },
        });
    });
    it("rejects switching tracking mode after evidence exists", async () => {
        m.activityCount.mockResolvedValue(1);
        expect(
            (await edit(req({ trackingMode: "CHECKPOINT" }), params())).status,
        ).toBe(422);
        expect(m.update).not.toHaveBeenCalled();
    });
    it("permits MULTI_DROP updates on activity transports", async () => {
        m.route.mockResolvedValue(transport.route);
        expect(
            (await edit(req({ transportMode: "MULTI_DROP" }), params())).status,
        ).toBe(200);
        expect(m.update).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { trackingMode: "ACTIVITY", transportMode: "MULTI_DROP" },
        });
    });
    it.each([null, [], "invalid"])(
        "rejects malformed plan/edit payload %j",
        async (body) => {
            expect((await plan(req(body))).status).toBe(422);
            expect((await edit(req(body), params())).status).toBe(422);
        },
    );
    it("defaults omitted tracking mode, rejecting invalid modes", () => {
        expect(parseTrackingMode(undefined)).toBe("CHECKPOINT");
        expect(parseTrackingMode("ACTIVITY")).toBe("ACTIVITY");
        expect(parseTrackingMode("bad")).toBeNull();
        expect(parseTrackingMode(null)).toBeNull();
    });
    it("accepts exact freshness limits and valid zero coordinates/accuracy", () => {
        const now = Date.now();
        for (const timestamp of [now - 300_000, now + 30_000]) {
            expect(
                activityCaptureError(
                    {
                        latitude: 0,
                        longitude: 0,
                        locationAccuracy: 0,
                        capturedAt: new Date(timestamp).toISOString(),
                    },
                    now,
                ),
            ).toBeNull();
        }
    });
    it("rejects invalid tracking modes before querying route", async () => {
        for (const body of [
            { trackingMode: "bad" },
            { trackingMode: null }
        ]) {
            expect((await plan(req(body))).status).toBe(422);
        }
        expect(m.route).not.toHaveBeenCalled();
    });
    it("permits checkpoint-free activity routes while retaining the checkpoint minimum", async () => {
        m.route.mockResolvedValue({ checkpoints: [] });
        m.vehicle.mockResolvedValue(null);
        const activity = await plan(
            req({ trackingMode: "ACTIVITY", routeId: 1, vehicleId: 2 }),
        );
        expect((await activity.json()).message).toBe(
            "Kendaraan tidak ditemukan.",
        );
        m.vehicle.mockClear();
        const checkpoint = await plan(req({ routeId: 1, vehicleId: 2 }));
        expect((await checkpoint.json()).message).toContain(
            "minimal 3 checkpoint",
        );
        expect(m.vehicle).not.toHaveBeenCalled();
    });
});


describe("arrival evidence", () => {
    it.each([{}, { ...payload(), photo: "" }, { ...payload(), capturedAt: "2020-01-01T00:00:00Z" }])("rejects missing or stale arrival evidence", async (body) => {
        m.transport.mockResolvedValue({ ...transport, status: "DEPARTED" });
        expect((await arrive(req(body), params())).status).toBe(422);
        expect(m.create).not.toHaveBeenCalled();
        expect(m.update).not.toHaveBeenCalled();
    });
    it("persists arrival photo, location and authenticated actor before arriving", async () => {
        m.transport.mockResolvedValue({ ...transport, status: "DEPARTED" });
        expect((await arrive(req(), params())).status).toBe(200);
        expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transportId: 10, photoUrl: photo, latitude: -6.2, recordedById: actor.id }) });
        expect(m.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { status: "ARRIVED", arrivedAt: expect.any(Date), statusBeforeArrival: "DEPARTED" } });
    });
    it("does not write arrival evidence if lifecycle changed concurrently", async () => {
        m.transport.mockResolvedValue({ ...transport, status: "DEPARTED" });
        m.updateMany.mockResolvedValueOnce({ count: 0 });
        expect((await arrive(req(), params())).status).toBe(409);
        expect(m.create).not.toHaveBeenCalled();
    });
    it("allows owner to read saved activity photos", async () => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true, employeeId: null, roles: [{ slug: "owner" }] });
        const response = await GET(req(), params());
        expect(response.status).toBe(200);
        expect(JSON.stringify(await response.json())).toContain(photo);
    });
});


describe("owner undo arrival", () => {
    const arrived = { ...transport, status: "ARRIVED", statusBeforeArrival: "DEPARTED", arrivedAt: new Date(), updatedAt: new Date() };
    it("denies a non-owner even with all permissions", async () => {
        m.auth.mockResolvedValue({ ...actor, permissions: ["*"] });
        expect((await undoArrival(req(), params())).status).toBe(403);
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it.each(["PLANNED", "DEPARTED"])("restores saved %s status, clears arrival time, and audits", async (previous) => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true });
        m.transport.mockResolvedValue({ ...arrived, statusBeforeArrival: previous });
        expect((await undoArrival(req(), params())).status).toBe(200);
        expect(m.updateMany).toHaveBeenCalledWith({
            where: { id: 10, status: "ARRIVED", arrivedAt: arrived.arrivedAt, updatedAt: arrived.updatedAt },
            data: { status: previous, arrivedAt: null, statusBeforeArrival: null },
        });
        expect(m.sync).toHaveBeenCalledWith(expect.anything(), 10, previous);
        expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "undo_arrival", after: { status: previous, arrivedAt: null } }));
        expect(m.create).not.toHaveBeenCalled();
        expect(m.shipmentUpdate).not.toHaveBeenCalled();
    });
    it.each(["PLANNED", "DEPARTED", "COMPLETED", "CANCELLED"])("rejects undo from %s", async (status) => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true });
        m.transport.mockResolvedValue({ ...arrived, status });
        expect((await undoArrival(req(), params())).status).toBe(422);
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it("rejects concurrent lifecycle changes", async () => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true });
        m.transport.mockResolvedValue(arrived);
        m.updateMany.mockResolvedValueOnce({ count: 0 });
        expect((await undoArrival(req(), params())).status).toBe(409);
        expect(m.audit).not.toHaveBeenCalled();
        expect(m.sync).not.toHaveBeenCalled();
    });
    it.each([
        ["ACTIVITY", null, "DEPARTED"],
        ["CHECKPOINT", null, "PLANNED"],
        ["CHECKPOINT", new Date(), "DEPARTED"],
    ])("restores legacy %s arrival with departedAt %s to %s", async (trackingMode, departedAt, expected) => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true });
        m.transport.mockResolvedValue({ ...arrived, trackingMode, departedAt, statusBeforeArrival: null });
        expect((await undoArrival(req(), params())).status).toBe(200);
        expect(m.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: expected, arrivedAt: null, statusBeforeArrival: null } }));
    });
    it("returns 404 for missing transport", async () => {
        m.auth.mockResolvedValue({ ...actor, isOwner: true });
        m.transport.mockResolvedValue(null);
        expect((await undoArrival(req(), params())).status).toBe(404);
    });
});
