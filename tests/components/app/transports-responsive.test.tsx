// @vitest-environment jsdom
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@/infrastructure/http/client-api";
import { formatDate } from "@/components/app/form-parts";

const m = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    permissions: [] as string[],
}));
vi.mock("@/hooks/use-auth", () => ({
    useAuth: () => ({ user: { isOwner: false } }),
}));
vi.mock("@/infrastructure/http/client-api", () => ({
    apiGet: m.get,
    apiPost: m.post,
    apiDelete: vi.fn(),
    hasPermission: (_user: unknown, permission: string) =>
        m.permissions.includes(permission),
}));
vi.mock("@/components/app/activity-log-panel", () => ({
    ActivityLogPanel: () => null,
}));
vi.mock("@/components/app/item-audit-dialog", () => ({
    ItemAuditDialog: () => null,
}));
vi.mock("@/components/app/transport-form-dialog", () => ({
    TransportFormDialog: () => null,
}));
vi.mock("@/components/app/capacity-status-card", () => ({
    CapacitySummaryInline: () => null,
}));
vi.mock("@/components/app/status-badge", () => ({
    StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TransportsPage } from "@/components/app/pages/transports-page";

const trips: Transport[] = ["PLANNED", "DEPARTED", "ARRIVED", "COMPLETED"].map(
    (status, index) => ({
        id: index + 1,
        transportCode: `TRP-${index + 1}`,
        status,
        routeId: 1,
        routeName: "Koridor Sumatra",
        routeCheckpoints: [],
        vehicleId: index + 1,
        vehicleNumber: `BK-${index + 1}`,
        vehicleName: "Truk",
        vehicleOwnerId: 3,
        driverName: ["Budi Santoso", "Dedi Putra", "Agus Wijaya", "Rudi Hasan"][
            index
        ],
        kenekName: ["Andi Saputra", "Eko Pratama", "Joko Susilo", "Fajar Hadi"][
            index
        ],
        origin: "Medan",
        destination: "Pekanbaru",
        plannedDepartureAt: "2026-10-16T08:00:00Z",
        plannedArrivalAt: "2026-10-17T09:30:00Z",
        departedAt: null,
        arrivedAt: null,
        createdAt: "2026-10-15T00:00:00Z",
        currentLatitude: null,
        currentLongitude: null,
        lastLocationAt: null,
        shipments: [],
        checkpointRecordsCount: 0,
        shipmentCount: 3,
        totalWeightKg: 1250.5,
        totalVolumeM3: 8.25,
        totalPrice: 2500000,
        settlement: null,
    }),
);

function article(id: number) {
    return screen.getByRole("article", { name: `Transport TRP-${id}` });
}

async function renderTrips(historyMode = false) {
    render(<TransportsPage historyMode={historyMode} />);
    await screen.findByRole("article", { name: "Transport TRP-1" });
}

function statusFilters() {
    return within(
        screen.getByRole("group", { name: "Filter status transport" }),
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    m.permissions = [
        "transport.view",
        "transport.create",
        "transport.depart",
        "transport.arrive",
        "transport.complete",
        "transport.settle",
    ];
    m.post.mockResolvedValue({});
    m.get.mockImplementation(async (url: string) => {
        if (url === "/options") return { warehouses: [] };
        if (
            url === "/transports" ||
            url === "/transports?history=true&mine=true"
        )
            return trips;
        throw new Error(`Unexpected API request: ${url}`);
    });
});

describe("responsive transports with the real DataTable", () => {
    it("renders trip articles with route, schedule, crew, load and details links alongside the xl table", async () => {
        await renderTrips();
        expect(screen.getAllByRole("article")).toHaveLength(4);
        const card = within(article(1));
        expect(card.getByText("BK-1")).toBeInTheDocument();
        expect(card.getByText("Asal")).toBeInTheDocument();
        expect(card.getByText("Medan")).toBeInTheDocument();
        expect(card.getByText("Tujuan")).toBeInTheDocument();
        expect(card.getByText("Pekanbaru")).toBeInTheDocument();
        expect(card.getByText("Rute: Koridor Sumatra")).toBeInTheDocument();
        expect(card.getByText("Berangkat")).toBeInTheDocument();
        expect(
            card.getByText(formatDate(trips[0].plannedDepartureAt, true)),
        ).toBeInTheDocument();
        expect(card.getByText("Estimasi tiba")).toBeInTheDocument();
        expect(
            card.getByText(formatDate(trips[0].plannedArrivalAt, true)),
        ).toBeInTheDocument();
        expect(card.getByText("Kru perjalanan")).toBeInTheDocument();
        expect(
            card.getByText("Budi Santoso · Andi Saputra"),
        ).toBeInTheDocument();
        expect(card.getByText("Shipment")).toBeInTheDocument();
        expect(card.getByText("3")).toBeInTheDocument();
        expect(card.getByText("1.250,5 kg")).toBeInTheDocument();
        expect(card.getByText("8,25 m³")).toBeInTheDocument();
        expect(card.getByText("Total harga muatan")).toBeInTheDocument();
        expect(card.getByText("Rp2.500.000")).toBeInTheDocument();
        expect(card.getByRole("link", { name: "TRP-1" })).toHaveAttribute(
            "href",
            "#/transports/1",
        );
        trips.forEach((trip) => {
            expect(
                within(article(trip.id)).getByRole("link", {
                    name: "Detail perjalanan",
                }),
            ).toHaveAttribute("href", `#/transports/${trip.id}`);
        });
        const table = screen.getByRole("table");
        expect(table.parentElement).toHaveClass("hidden", "xl:block");
        expect(table.parentElement!.nextElementSibling).toHaveClass(
            "grid",
            "md:grid-cols-2",
            "xl:hidden",
        );
    });

    it.each([
        { query: "  bUdI SaNtOsO  ", id: 1 },
        { query: "  EKO PRATAMA  ", id: 2 },
    ])(
        "searches crew case-insensitively and trims surrounding whitespace: $query",
        async ({ query, id }) => {
            await renderTrips();
            fireEvent.change(
                screen.getByRole("textbox", { name: "Cari transport" }),
                { target: { value: query } },
            );
            expect(screen.getAllByRole("article")).toHaveLength(1);
            expect(article(id)).toBeInTheDocument();
            expect(screen.getByRole("status")).toHaveTextContent(
                "1 transport ditampilkan",
            );
            expect(
                statusFilters().getByRole("button", { name: /^Semua\s*4$/ }),
            ).toBeInTheDocument();
        },
    );

    it("treats whitespace-only search as no search", async () => {
        await renderTrips();
        fireEvent.change(
            screen.getByRole("textbox", { name: "Cari transport" }),
            { target: { value: "   " } },
        );
        expect(screen.getAllByRole("article")).toHaveLength(4);
        expect(screen.getByRole("status")).toHaveTextContent(
            "4 transport ditampilkan",
        );
    });

    it.each([false, true])(
        "filters Selesai using an Indonesian status button and count (historyMode=%s)",
        async (historyMode) => {
            await renderTrips(historyMode);
            expect(m.get).toHaveBeenCalledWith(
                historyMode
                    ? "/transports?history=true&mine=true"
                    : "/transports",
            );
            const completed = statusFilters().getByRole("button", {
                name: /^Selesai\s*1$/,
            });
            expect(completed).toHaveAttribute("aria-pressed", "false");
            fireEvent.click(completed);
            expect(completed).toHaveAttribute("aria-pressed", "true");
            expect(screen.getAllByRole("article")).toHaveLength(1);
            expect(article(4)).toBeInTheDocument();
            expect(
                statusFilters().queryByRole("button", { name: /COMPLETED/ }),
            ).not.toBeInTheDocument();
        },
    );

    it("filters Dalam perjalanan and resets both search and status", async () => {
        await renderTrips();
        const departed = statusFilters().getByRole("button", {
            name: /^Dalam perjalanan\s*1$/,
        });
        fireEvent.click(departed);
        fireEvent.change(
            screen.getByRole("textbox", { name: "Cari transport" }),
            { target: { value: "Dedi" } },
        );
        expect(departed).toHaveAttribute("aria-pressed", "true");
        expect(screen.getAllByRole("article")).toHaveLength(1);
        expect(article(2)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Reset filter" }));
        expect(
            screen.getByRole("textbox", { name: "Cari transport" }),
        ).toHaveValue("");
        expect(
            statusFilters().getByRole("button", { name: /^Semua\s*4$/ }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(departed).toHaveAttribute("aria-pressed", "false");
        expect(screen.getAllByRole("article")).toHaveLength(4);
        expect(
            screen.queryByRole("button", { name: "Reset filter" }),
        ).not.toBeInTheDocument();
    });

    it("shows an empty filtered state and lets either reset control restore all trips", async () => {
        await renderTrips();
        fireEvent.click(
            statusFilters().getByRole("button", { name: /^Selesai\s*1$/ }),
        );
        fireEvent.change(
            screen.getByRole("textbox", { name: "Cari transport" }),
            { target: { value: "no matching crew" } },
        );
        expect(screen.queryByRole("article")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(
            screen.getByText(
                "Tidak ada transport yang cocok. Coba kata kunci atau status lain.",
            ),
        ).toBeInTheDocument();
        const resets = screen.getAllByRole("button", { name: "Reset filter" });
        expect(resets).toHaveLength(2);
        fireEvent.click(resets[1]);
        expect(
            screen.getByRole("textbox", { name: "Cari transport" }),
        ).toHaveValue("");
        expect(
            statusFilters().getByRole("button", { name: /^Semua\s*4$/ }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(screen.getAllByRole("article")).toHaveLength(4);
    });

    it("hides transport data and controls without view permission even after the API resolves", async () => {
        m.permissions = [
            "transport.create",
            "transport.depart",
            "transport.arrive",
            "transport.complete",
            "transport.settle",
        ];
        render(<TransportsPage />);
        await waitFor(() => expect(m.get).toHaveResolvedWith(trips));
        expect(
            screen.getByText("Anda tidak memiliki izin melihat transport."),
        ).toBeInTheDocument();
        expect(screen.queryByRole("article")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.queryByText("TRP-1")).not.toBeInTheDocument();
        expect(
            screen.queryByText("Budi Santoso · Andi Saputra"),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Rencanakan Transport" }),
        ).not.toBeInTheDocument();
    });

    it("preserves card actions for each lifecycle state with full permissions", async () => {
        await renderTrips();
        const planned = within(article(1));
        expect(
            planned.getByRole("button", { name: "Depart" }),
        ).toBeInTheDocument();
        expect(
            planned.getByRole("button", { name: "Tandai Tiba" }),
        ).toBeInTheDocument();
        expect(
            planned.getByRole("button", { name: "Edit TRP-1" }),
        ).toBeInTheDocument();
        expect(
            planned.getByRole("button", { name: "Hapus TRP-1" }),
        ).toBeInTheDocument();
        expect(
            planned.queryByRole("button", {
                name: /Konfirmasi Completed|Settle/,
            }),
        ).not.toBeInTheDocument();
        const departed = within(article(2));
        expect(
            departed.getByRole("button", { name: "Tandai Tiba" }),
        ).toBeInTheDocument();
        expect(
            departed.queryByRole("button", {
                name: /Depart|Edit|Hapus|Konfirmasi Completed|Settle/,
            }),
        ).not.toBeInTheDocument();
        const arrived = within(article(3));
        expect(
            arrived.getByRole("button", { name: "Konfirmasi Completed" }),
        ).toBeInTheDocument();
        expect(
            arrived.getByRole("button", { name: "Settle" }),
        ).toBeInTheDocument();
        expect(
            arrived.queryByRole("button", {
                name: /Depart|Edit|Hapus|Tandai Tiba/,
            }),
        ).not.toBeInTheDocument();
        const completed = within(article(4));
        expect(
            completed.getByRole("button", { name: "Settle" }),
        ).toBeInTheDocument();
        expect(
            completed.queryByRole("button", {
                name: /Depart|Edit|Hapus|Tandai Tiba|Konfirmasi Completed/,
            }),
        ).not.toBeInTheDocument();
    });

    it.each([
        {
            permission: "transport.create",
            expected: ["Edit TRP-1", "Hapus TRP-1"],
        },
        { permission: "transport.depart", expected: ["Depart"] },
        {
            permission: "transport.arrive",
            expected: ["Tandai Tiba", "Tandai Tiba"],
        },
        {
            permission: "transport.complete",
            expected: ["Konfirmasi Completed"],
        },
        { permission: "transport.settle", expected: ["Settle", "Settle"] },
        { permission: "", expected: [] },
    ])(
        "shows only permitted card actions with view plus $permission",
        async ({ permission, expected }) => {
            m.permissions = ["transport.view", permission];
            await renderTrips();
            const actions = screen.getAllByRole("article").flatMap((card) =>
                within(card)
                    .queryAllByRole("button")
                    .map(
                        (button) =>
                            button.getAttribute("aria-label") ??
                            button.textContent?.trim(),
                    ),
            );
            expect(actions).toEqual(expected);
            trips.forEach((trip) => {
                expect(
                    within(article(trip.id)).getByRole("link", {
                        name: "Detail perjalanan",
                    }),
                ).toBeInTheDocument();
            });
        },
    );

    it("keeps arrival-only card confirmation separate from auditor completion", async () => {
        m.permissions = ["transport.view", "transport.arrive"];
        await renderTrips();
        expect(
            within(article(3)).queryByRole("button", {
                name: "Konfirmasi Completed",
            }),
        ).not.toBeInTheDocument();
        fireEvent.click(
            within(article(2)).getByRole("button", { name: "Tandai Tiba" }),
        );
        const dialog = within(screen.getByRole("alertdialog"));
        expect(dialog.getByText(/bukan COMPLETED/)).toBeInTheDocument();
        fireEvent.click(
            dialog.getByRole("button", { name: "Ya, Tandai Tiba" }),
        );
        await waitFor(() =>
            expect(m.post).toHaveBeenCalledWith("/transports/2/arrive"),
        );
        expect(m.post).toHaveBeenCalledTimes(1);
    });
});
