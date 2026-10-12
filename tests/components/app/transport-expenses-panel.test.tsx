// @vitest-environment jsdom
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportExpensesPanel } from "@/components/app/transport-expenses-panel";

const m = vi.hoisted(() => ({
    post: vi.fn(),
    put: vi.fn(),
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
    apiDelete: vi.fn(),
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
    it("renders approval snapshot, coordinates and pending-only actions", async () => {
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
        ).toHaveLength(1);
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
            screen.queryByRole("button", { name: "Hapus biaya" }),
        ).not.toBeInTheDocument();
    });
    it("hides approval when permission is absent", () => {
        m.rows = [pending];
        render(<TransportExpensesPanel {...props} canApprove={false} />);
        expect(
            screen.queryByRole("button", { name: "Approve" }),
        ).not.toBeInTheDocument();
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
