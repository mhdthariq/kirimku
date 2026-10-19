// @vitest-environment jsdom
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportManifestPrint } from "../../../src/components/app/transport-manifest-print";
import { COMPANY_NAME } from "../../../src/shared/company";

const { apiGet, apiPost, auth } = vi.hoisted(() => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    auth: { user: null, companyName: "PT Tenant Logistik" as string | null },
}));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet, apiPost }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

const transport = {
    id: 1,
    transportCode: "TR-001",
    status: "PLANNED",
    routeName: null,
    checkpoints: [],
    origin: "Medan",
    destination: "Binjai",
    vehicle: { vehicleNumber: "BK 1234", name: null },
    driver: null,
    kenek: null,
    plannedDepartureAt: null,
    plannedArrivalAt: null,
    shipments: [],
    shipmentCount: 0,
    totalWeightKg: 0,
    totalVolumeM3: 0,
    totalPrice: null,
};

beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset().mockResolvedValue({});
    document.title = "KirimKu";
    auth.companyName = "PT Tenant Logistik";
});

describe("TransportManifestPrint mode", () => {
    it("omits an unassigned Kenek and prints the warehouse staff signature", async () => {
        apiGet.mockImplementation(async (path: string) => path.endsWith("/drops") ? { transportMode: "DIRECT" } : { ...transport, warehouseStaff: { id: 9, name: "Budi Gudang" } });
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        expect(await screen.findByText("Budi Gudang")).toBeInTheDocument();
        expect(screen.queryByText("Kenek")).not.toBeInTheDocument();
        expect(screen.getByText("Petugas Gudang")).toBeInTheDocument();
    });
    it("uses the drops API mode, even when transport detail has no checkpoints or mode", async () => {
        apiGet.mockImplementation(async (path: string) =>
            path.endsWith("/drops")
                ? { transportMode: "MULTI_DROP" }
                : transport,
        );
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        expect(await screen.findByText("MULTI_DROP")).toBeInTheDocument();
        expect(screen.queryByText("DIRECT")).not.toBeInTheDocument();
        expect(apiGet).toHaveBeenCalledWith("/transports/1/drops");
    });

    it("keeps the manifest available without inventing a mode when the drops request fails", async () => {
        apiGet.mockImplementation(async (path: string) => {
            if (path.endsWith("/drops")) throw new Error("Unavailable");
            return transport;
        });
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        await waitFor(() =>
            expect(screen.getAllByText("TR-001").length).toBeGreaterThan(0),
        );
        expect(screen.queryByText("DIRECT")).not.toBeInTheDocument();
        expect(screen.getByText("Mode").parentElement).toHaveTextContent("—");
    });
});

describe("manifest print document", () => {
    it("uses the shared company fallback when tenant branding is unavailable", async () => {
        auth.companyName = null;
        apiGet.mockResolvedValue(transport);
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        expect(await screen.findByText(COMPANY_NAME)).toBeInTheDocument();
        expect(
            screen.getByText(/Dokumen ini dicetak dari sistem/),
        ).toHaveTextContent(COMPANY_NAME);
    });
    it("uses tenant branding rather than mixed shipment customer names and omits all pricing", async () => {
        apiGet.mockResolvedValue({
            ...transport,
            shipmentCount: 2,
            totalPrice: 987654321,
            totalWeightKg: 24,
            totalVolumeM3: 2,
            shipments: ["Customer A", "Customer B"].map(
                (customerName, index) => ({
                    id: index + 1,
                    masterCode: `RESI-${index + 1}`,
                    customerName,
                    penerimaName: "Penerima",
                    destination: "Binjai",
                    packages: 3,
                    weightKg: 12,
                    volumeM3: 1,
                    priceAmount: 123456789,
                }),
            ),
        });
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        expect(
            await screen.findByText("PT Tenant Logistik"),
        ).toBeInTheDocument();
        const table = screen.getByRole("table");
        expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
        expect(
            within(table).queryByRole("columnheader", { name: "Harga" }),
        ).not.toBeInTheDocument();
        expect(table).not.toHaveTextContent(
            /123[.,]456[.,]789|987[.,]654[.,]321/,
        );
        const rows = table.querySelectorAll("tbody tr");
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.children).toHaveLength(8);
            expect(row.lastElementChild).toBeEmptyDOMElement();
            expect(row.lastElementChild).toHaveStyle({ height: "80px" });
        }
        expect(table.querySelector("tfoot tr")?.children).toHaveLength(5);
        expect(table.querySelector("tfoot")).toHaveTextContent(
            "TOTAL (2 shipment)",
        );
        expect(screen.getByText("Customer A → Penerima")).toBeInTheDocument();
        expect(screen.getByText("Customer B → Penerima")).toBeInTheDocument();
        expect(
            screen.queryByText(/tanda tangan \/ cap|nama & tanda tangan/),
        ).not.toBeInTheDocument();
    });

    it("keeps the tenant-branded footer inside the same paper template in preview and print", async () => {
        apiGet.mockResolvedValue(transport);
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        const footer = await screen.findByText(/Dokumen ini dicetak dari sistem/);
        expect(footer).toHaveClass("manifest-print-footer");
        expect(footer).toHaveTextContent("PT Tenant Logistik — manifest transport TR-001.");
        expect(document.querySelector(".manifest-sheet")).toContainElement(footer);
        expect(footer.closest(".paper-preview")).not.toBeNull();
    });

    it("provides signing space before crew lines and a wrapping mobile toolbar", async () => {
        apiGet.mockResolvedValue({
            ...transport,
            driver: { name: "Budi" },
            kenek: { name: "Andi" },
        });
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        const warehouseLine = await screen.findByText("Petugas Gudang");
        const signatures = warehouseLine.parentElement?.parentElement;
        expect(signatures).toHaveClass("pt-20", "break-inside-avoid");
        expect(signatures).toHaveTextContent(
            "DriverBudiKenekAndiPetugas Gudang",
        );
        const toolbar = document.querySelector(".manifest-toolbar");
        expect(toolbar).toHaveClass("flex-col", "sm:flex-row");
        expect(
            screen.getByRole("button", { name: "Tutup" }).parentElement,
        ).toHaveClass("flex-wrap");
    });
    it("uses the transport code as the document/PDF title and restores the previous title on exit", async () => {
        apiGet.mockResolvedValue(transport);
        const { unmount } = render(
            <TransportManifestPrint transportId={1} onClose={vi.fn()} />,
        );
        await waitFor(() => expect(document.title).toBe("Manifest TR-001"));
        unmount();
        expect(document.title).toBe("KirimKu");
    });

    it("prints with the dynamic title and preserves fire-and-forget audit logging", async () => {
        apiGet.mockResolvedValue(transport);
        apiPost.mockRejectedValue(new Error("Audit unavailable"));
        const print = vi.spyOn(window, "print").mockImplementation(() => {
            expect(document.title).toBe("Manifest TR-001");
        });
        const onClose = vi.fn();
        render(<TransportManifestPrint transportId={1} onClose={onClose} />);
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Cetak / Simpan PDF" }),
            ).toBeEnabled(),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Cetak / Simpan PDF" }),
        );
        expect(apiPost).toHaveBeenCalledWith("/transports/1/print-log", {});
        await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        print.mockRestore();
    });

    it("disables printing while loading and when the transport cannot be loaded", async () => {
        apiGet.mockRejectedValue(new Error("Unavailable"));
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        expect(
            screen.getByRole("button", { name: "Cetak / Simpan PDF" }),
        ).toBeDisabled();
        expect(
            await screen.findByText("Transport tidak ditemukan."),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Cetak / Simpan PDF" }),
        ).toBeDisabled();
        expect(document.title).toBe("KirimKu");
    });

    it("assigns an A4 portrait page and keeps the manifest visible in the shared print stylesheet", async () => {
        apiGet.mockResolvedValue(transport);
        render(<TransportManifestPrint transportId={1} onClose={vi.fn()} />);
        await screen.findByText("Manifest Transport / Surat Jalan");
        expect(document.querySelector(".manifest-sheet")).toHaveClass(
            "a4-sheet",
        );
        expect(
            document.querySelector("#manifest-print-portal"),
        ).toHaveAttribute("data-print-portal");
        const globalCss = readFileSync("src/app/globals.css", "utf8");
        expect(globalCss).toContain("size: A4 portrait;");
        expect(globalCss).toContain(
            "body:has([data-print-portal]) > *:not([data-print-portal])",
        );
    });
});
