// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ShipmentPayments } from "@/components/app/shipment-payments";
import { ResiPrint } from "@/components/app/resi-print";

const m = vi.hoisted(() => ({
    post: vi.fn(),
    get: vi.fn(),
    changed: vi.fn(),
    user: {
        name: "Admin",
        isOwner: false,
        partnerType: null,
        roles: [{ slug: "admin-gudang" }],
        permissions: ["payment.view"],
    },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
    ...(await original<typeof import("@/infrastructure/http/client-api")>()),
    apiPost: m.post,
    apiGet: m.get,
}));
vi.mock("qrcode", () => ({
    default: { toDataURL: async () => "data:image/png;base64,AA" },
}));
vi.mock("@/components/app/form-parts", async (original) => ({
    ...(await original<typeof import("@/components/app/form-parts")>()),
    FormSelect: ({
        value,
        onValueChange,
        options,
    }: {
        value: string;
        onValueChange: (v: string) => void;
        options: { value: string; label: string }[];
    }) => (
        <select
            aria-label="Metode pembayaran"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    ),
}));
const pending = {
    id: 1,
    masterId: 12,
    amount: 90000,
    method: "CASH",
    status: "RECORDED",
    createdAt: "2026-10-18",
    reference: "<script>alert(1)</script>",
    verifiedAt: null,
};
function shipment(overrides = {}) {
    return {
        id: 12,
        masterCode: "MKT-12",
        origin: "Medan",
        destination: "Aceh",
        createdAt: "2026-10-18",
        customer: { type: "b2c", name: "Customer" },
        status: "CREATED",
        priceAmount: 100000,
        finalPriceAmount: 90000,
        paymentTrackingEnabled: true,
        payments: [pending],
        details: [],
        insuranceAmount: 0,
        ...overrides,
    } as unknown as ComponentProps<typeof ShipmentPayments>["shipment"];
}
beforeEach(() => {
    vi.clearAllMocks();
    m.user.permissions = ["payment.view"];
    m.post.mockResolvedValue({ id: 2 });
    m.get.mockResolvedValue({ warehouses: [] });
    m.changed.mockResolvedValue(undefined);
});

describe("Pembayaran option", () => {
    it("shows pending history without falsely marking the shipment paid", () => {
        render(
            <ShipmentPayments shipment={shipment()} onChanged={m.changed} />,
        );
        expect(screen.getByText("Belum Lunas")).toBeInTheDocument();
        expect(screen.getByText(/Menunggu verifikasi$/)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Catat Pembayaran" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Verifikasi" }),
        ).not.toBeInTheDocument();
        expect(document.querySelector("script")).toBeNull();
    });
    it("records transfer amount/reference and refreshes shipment for subsequent printing", async () => {
        render(
            <ShipmentPayments shipment={shipment()} onChanged={m.changed} />,
        );
        const user = userEvent.setup();
        await user.selectOptions(screen.getByRole("combobox"), "TRANSFER");
        fireEvent.change(screen.getByLabelText("Nominal pembayaran"), {
            target: { value: "50000" },
        });
        await user.type(
            screen.getByLabelText("Referensi pembayaran (opsional)"),
            "BANK-REF",
        );
        await user.click(
            screen.getByRole("button", { name: "Catat Pembayaran" }),
        );
        await waitFor(() =>
            expect(m.post).toHaveBeenCalledWith("/shipments/12/payments", {
                method: "TRANSFER",
                amount: 50000,
                reference: "BANK-REF",
            }),
        );
        await waitFor(() => expect(m.changed).toHaveBeenCalledOnce());
    });
    it("keeps failed recording values and does not refresh as if successful", async () => {
        m.post.mockRejectedValue(new Error("Outside scope"));
        render(
            <ShipmentPayments shipment={shipment()} onChanged={m.changed} />,
        );
        fireEvent.change(screen.getByLabelText("Nominal pembayaran"), {
            target: { value: "50000" },
        });
        fireEvent.submit(
            screen
                .getByRole("button", { name: "Catat Pembayaran" })
                .closest("form")!,
        );
        await waitFor(() => expect(m.post).toHaveBeenCalled());
        expect(screen.getByLabelText("Nominal pembayaran")).toHaveValue(50000);
        expect(m.changed).not.toHaveBeenCalled();
    });
    it.each(["verify", "reject"])(
        "allows authorized %s action and refreshes",
        async (action) => {
            m.user.permissions.push("payment.verify");
            render(
                <ShipmentPayments
                    shipment={shipment()}
                    onChanged={m.changed}
                />,
            );
            await userEvent.setup().click(
                screen.getByRole("button", {
                    name: action === "verify" ? "Verifikasi" : "Tolak",
                }),
            );
            await waitFor(() =>
                expect(m.post).toHaveBeenCalledWith(`/payments/1/${action}`),
            );
            expect(m.changed).toHaveBeenCalledOnce();
        },
    );
    it.each([{ customer: { type: "b2b" } }, { paymentTrackingEnabled: false }])(
        "hides option for B2B and Marketing/legacy B2C: %j",
        (fields) => {
            const { container } = render(
                <ShipmentPayments
                    shipment={shipment(fields)}
                    onChanged={m.changed}
                />,
            );
            expect(container).toBeEmptyDOMElement();
        },
    );
    it("requires payment.view", () => {
        m.user.permissions = [];
        const { container } = render(
            <ShipmentPayments shipment={shipment()} onChanged={m.changed} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
    it("shows tracking to view-only staff without recording controls", () => {
        const roles = m.user.roles;
        m.user.roles = [{ slug: "staff-gudang" }];
        render(
            <ShipmentPayments shipment={shipment()} onChanged={m.changed} />,
        );
        expect(screen.getByText("Belum Lunas")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Catat Pembayaran" }),
        ).not.toBeInTheDocument();
        m.user.roles = roles;
    });
    it.each([
        { status: "CANCELLED" },
        { payments: [{ ...pending, status: "VERIFIED" }] },
    ])(
        "disables new recording on cancelled or fully paid shipments: %j",
        (fields) => {
            render(
                <ShipmentPayments
                    shipment={shipment(fields)}
                    onChanged={m.changed}
                />,
            );
            expect(
                screen.queryByRole("button", { name: "Catat Pembayaran" }),
            ).not.toBeInTheDocument();
        },
    );
});

describe("actual master resi payment rendering", () => {
    it.each([
        [[], "Belum Lunas", "0", "90.000"],
        [[pending], "Belum Lunas", "0", "90.000"],
        [
            [
                { ...pending, status: "VERIFIED", amount: 30000 },
                { ...pending, id: 2, status: "REJECTED" },
            ],
            "Sebagian",
            "30.000",
            "60.000",
        ],
        [[{ ...pending, status: "VERIFIED" }], "Lunas", "90.000", "0"],
    ])(
        "prints verified-only status %s / %s",
        (payments, label, paid, remaining) => {
            render(
                <ResiPrint
                    shipment={{ ...shipment({ payments }), details: [] }}
                    onClose={() => {}}
                />,
            );
            const payment = screen.getByLabelText("Pembayaran resi");
            expect(payment).toHaveTextContent(`Pembayaran: ${label}`);
            expect(payment).toHaveTextContent(
                new RegExp(`Dibayar: Rp\\s*${paid.replaceAll(".", "\\.")}`),
            );
            expect(payment).toHaveTextContent(
                new RegExp(`Sisa: Rp\\s*${remaining.replaceAll(".", "\\.")}`),
            );
        },
    );
    it("prints unpriced without implying paid", () => {
        render(
            <ResiPrint
                shipment={{
                    ...shipment({ priceAmount: null, finalPriceAmount: null }),
                    details: [],
                }}
                onClose={() => {}}
            />,
        );
        expect(screen.getByLabelText("Pembayaran resi")).toHaveTextContent(
            "Belum dihitung",
        );
    });
    it("keeps B2B invoice-only even with tracking mistakenly enabled", () => {
        render(
            <ResiPrint
                shipment={{
                    ...shipment({
                        customer: { type: "b2b", name: "Company" },
                        invoiceLines: [
                            {
                                invoice: {
                                    id: 1,
                                    invoiceNumber: "INV-1",
                                    status: "SENT",
                                },
                            },
                        ],
                    }),
                    details: [],
                }}
                onClose={() => {}}
            />,
        );
        expect(screen.getByText("Inv. INV-1")).toBeInTheDocument();
        expect(
            screen.queryByLabelText("Pembayaran resi"),
        ).not.toBeInTheDocument();
    });
    it("does not add payment details to Marketing/legacy B2C resi", () => {
        render(
            <ResiPrint
                shipment={{
                    ...shipment({ paymentTrackingEnabled: false }),
                    details: [],
                }}
                onClose={() => {}}
            />,
        );
        expect(
            screen.queryByLabelText("Pembayaran resi"),
        ).not.toBeInTheDocument();
    });
});
