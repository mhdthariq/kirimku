// @vitest-environment jsdom
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportExpensesPanel } from "@/components/app/transport-expenses-panel";

const m = vi.hoisted(() => ({
    post: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    gps: vi.fn(),
    error: vi.fn(),
    rows: [] as unknown[],
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/infrastructure/http/client-api", () => ({
    apiGet: vi.fn(),
    apiPost: m.post,
    apiPut: m.put,
    apiDelete: m.remove,
    hasPermission: () => false,
}));
vi.mock("@/hooks/use-api-data", () => ({
    useApiData: () => ({ data: m.rows, loading: false, reload: m.reload }),
    runAction: async (fn: () => Promise<unknown>) => {
        await fn();
        return true;
    },
}));
vi.mock("sonner", () => ({ toast: { error: m.error } }));
const pending = {
    id: 1,
    expenseCode: "EXP-1",
    transportId: 10,
    type: "BBM",
    amount: 100,
    description: null,
    hasPhoto: false,
    createdAt: "2026-10-01T00:00:00Z",
    status: "PENDING",
    latitude: 0,
    longitude: 0,
    locationAccuracy: 5,
};
const props = {
    transportId: 10,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canApprove: true,
};
beforeEach(() => {
    vi.resetAllMocks();
    m.rows = [];
    Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: m.gps },
    });
    m.gps.mockImplementation((success) =>
        success({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 5 } }),
    );
});
async function submitExpense() {
    fireEvent.click(screen.getByRole("button", { name: /Tambah Biaya/ }));
    fireEvent.change(screen.getByLabelText("Nominal (Rp)"), {
        target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tambah" }));
    await act(async () => {});
}
describe("expense panel GPS and approval", () => {
    it("lets a delegated deleter remove an approved cost only after confirming a reason", async () => {
        m.rows = [{ ...pending, status: "APPROVED" }];
        render(<TransportExpensesPanel {...props} canApprove={false} />);
        fireEvent.click(screen.getByRole("button", { name: "Hapus biaya" }));
        expect(m.remove).not.toHaveBeenCalled();
        const dialog = within(screen.getByRole("dialog"));
        expect(dialog.getByRole("button", { name: "Hapus biaya" })).toBeDisabled();
        fireEvent.change(dialog.getByLabelText("Alasan (wajib)"), { target: { value: "Salah input" } });
        fireEvent.click(dialog.getByRole("button", { name: "Hapus biaya" }));
        await waitFor(() => expect(m.remove).toHaveBeenCalledWith("/transports/10/expenses/1", { reason: "Salah input" }));
    });
    it("does not imply delete permission from approval permission", () => {
        m.rows = [{ ...pending, status: "APPROVED" }];
        render(<TransportExpensesPanel {...props} canDelete={false} />);
        expect(screen.queryByRole("button", { name: "Hapus biaya" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Batalkan approval" })).toBeInTheDocument();
    });
    it("offers Biaya Tol and submits the TOL category with fresh GPS", async () => {
        Object.defineProperty(Element.prototype, "scrollIntoView", {
            configurable: true,
            value: vi.fn(),
        });
        render(<TransportExpensesPanel {...props} />);
        expect(screen.getByText("Biaya Tol")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Tambah Biaya/ }));
        fireEvent.click(screen.getByRole("combobox"));
        fireEvent.click(
            await screen.findByRole("option", { name: "Biaya Tol" }),
        );
        fireEvent.change(screen.getByLabelText("Nominal (Rp)"), {
            target: { value: "25000" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Tambah" }));
        await waitFor(() =>
            expect(m.post).toHaveBeenCalledWith(
                "/transports/10/expenses",
                expect.objectContaining({
                    type: "TOL",
                    amount: 25000,
                    latitude: -6.2,
                    longitude: 106.8,
                    locationAccuracy: 5,
                }),
            ),
        );
    });
    it("displays and edits a saved toll expense without changing its category", async () => {
        m.rows = [{ ...pending, type: "TOL", amount: 25000 }];
        render(<TransportExpensesPanel {...props} />);
        expect(screen.getByText(/Biaya Tol ·/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Edit biaya" }));
        expect(screen.getByRole("combobox")).toHaveTextContent("Biaya Tol");
        fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
        await waitFor(() =>
            expect(m.put).toHaveBeenCalledWith(
                "/transports/10/expenses/1",
                expect.objectContaining({ type: "TOL", amount: 25000 }),
            ),
        );
    });
    it("captures fresh GPS before creation and keeps receipt picker unrestricted", async () => {
        render(<TransportExpensesPanel {...props} />);
        await submitExpense();
        expect(m.gps).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
        expect(m.post).toHaveBeenCalledWith(
            "/transports/10/expenses",
            expect.objectContaining({
                latitude: -6.2,
                longitude: 106.8,
                locationAccuracy: 5,
            }),
        );
        expect(m.reload).toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: /Tambah Biaya/ }));
        expect(
            document.querySelector('input[type="file"]'),
        ).not.toHaveAttribute("capture");
    });
    it("blocks submission on GPS denial", async () => {
        m.gps.mockImplementation((_success, error) => error({ code: 1 }));
        render(<TransportExpensesPanel {...props} />);
        await submitExpense();
        expect(m.post).not.toHaveBeenCalled();
        expect(m.error).toHaveBeenCalledWith(
            expect.stringContaining("GPS gagal"),
        );
    });
    it("renders approval snapshot, coordinates, pending edits and approver reversal actions", async () => {
        m.rows = [
            pending,
            {
                ...pending,
                id: 2,
                status: "APPROVED",
                approvedByUsername: "andi",
                approvedByRole: "Admin Finance",
            },
        ];
        render(<TransportExpensesPanel {...props} />);
        expect(screen.getByText("Pending")).toBeInTheDocument();
        expect(screen.getByText("Approved")).toBeInTheDocument();
        expect(
            screen.getByText("Approve by andi(Admin Finance)"),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("link")[0]).toHaveAttribute(
            "href",
            "https://www.google.com/maps?q=0,0",
        );
        expect(
            screen.getAllByRole("button", { name: "Edit biaya" }),
        ).toHaveLength(1);
        expect(
            screen.getAllByRole("button", { name: "Hapus biaya" }),
        ).toHaveLength(2);
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));
        await waitFor(() =>
            expect(m.post).toHaveBeenCalledWith(
                "/transports/10/expenses/1/approve",
            ),
        );
        expect(m.reload).toHaveBeenCalled();
    });
    it("labels migrated approved expenses without inventing an approver", () => {
        m.rows = [
            {
                ...pending,
                status: "APPROVED",
                approvedById: null,
                approvedByUsername: null,
                approvedByRole: null,
                approvedAt: null,
            },
        ];
        render(<TransportExpensesPanel {...props} />);
        expect(screen.getByText("Approved")).toBeInTheDocument();
        expect(
            screen.getByText("Biaya lama (migrasi); penyetuju tidak tercatat."),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Approve by/)).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Approve" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Edit biaya" }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Hapus biaya" }),
        ).toBeInTheDocument();
    });
    it("hides approval when permission is absent", () => {
        m.rows = [pending];
        render(<TransportExpensesPanel {...props} canApprove={false} />);
        expect(
            screen.queryByRole("button", { name: "Approve" }),
        ).not.toBeInTheDocument();
    });
    it("keeps creation available when all existing expenses are approved", async () => {
        m.rows = [{ ...pending, status: "APPROVED" }];
        render(<TransportExpensesPanel {...props} transportStatus="ARRIVED" />);
        expect(
            screen.getByText(/Approval berlaku per biaya/),
        ).toBeInTheDocument();
        await submitExpense();
        expect(m.post).toHaveBeenCalledWith(
            "/transports/10/expenses",
            expect.any(Object),
        );
    });
    it("blocks creation and editing on completed transports but keeps approval available", () => {
        m.rows = [pending];
        render(
            <TransportExpensesPanel {...props} transportStatus="COMPLETED" />,
        );
        expect(
            screen.queryByRole("button", { name: /Tambah Biaya/ }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Edit biaya" }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Approve" }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Penambahan biaya dan unggah foto ditutup/),
        ).toBeInTheDocument();
    });
    it("blocks an already-open form if transport completes before submit", async () => {
        const view = render(
            <TransportExpensesPanel {...props} transportStatus="ARRIVED" />,
        );
        fireEvent.click(screen.getByRole("button", { name: /Tambah Biaya/ }));
        fireEvent.change(screen.getByLabelText("Nominal (Rp)"), {
            target: { value: "100" },
        });
        view.rerender(
            <TransportExpensesPanel {...props} transportStatus="COMPLETED" />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Tambah" }));
        await act(async () => {});
        expect(m.post).not.toHaveBeenCalled();
        expect(m.gps).not.toHaveBeenCalled();
        expect(m.error).toHaveBeenCalledWith(
            expect.stringContaining("COMPLETED"),
        );
    });
    it("captures new GPS on edit rather than reusing stored coordinates", async () => {
        m.rows = [pending];
        render(<TransportExpensesPanel {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "Edit biaya" }));
        fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
        await waitFor(() =>
            expect(m.put).toHaveBeenCalledWith(
                "/transports/10/expenses/1",
                expect.objectContaining({
                    latitude: -6.2,
                    longitude: 106.8,
                    locationAccuracy: 5,
                }),
            ),
        );
    });
});
