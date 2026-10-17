// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PickupsPage } from "@/components/app/pages/pickups-page";
import { DeliveriesPage } from "@/components/app/pages/deliveries-page";
import { ReturnTasksPage } from "@/components/app/pages/return-tasks-page";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), permissions: [] as string[] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { permissions: m.permissions, isOwner: false } }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: m.get, apiPost: m.post,
}));
vi.mock("@/components/app/item-audit-dialog", () => ({ ItemAuditDialog: () => null }));
vi.mock("@/components/app/qr-scan-dialog", () => ({ QrScanDialog: ({ open, task }: { open: boolean; task: { code: string } | null }) => open ? <div role="dialog" aria-label="Scan task">{task?.code}</div> : null }));

const task = { id: 1, masterCode: "SHP-1", customerName: "Sumatra Jaya", customerType: "b2c", status: "ASSIGNED", origin: "Medan", destination: "Banda Aceh", kurirId: 2, detailsCount: 2, scannedCount: 1, createdAt: "2026-10-17", details: [{ id: 1, detailCode: "PKG-1", description: "Karton", scanned: true }], priceAmount: 185000 };
beforeEach(() => {
  vi.clearAllMocks();
  m.permissions = ["pickup.view", "pickup.scan", "delivery.view", "delivery.scan", "return-task.view", "return-task.approve"];
  m.post.mockResolvedValue({});
  m.get.mockImplementation(async (path: string) => {
    if (path === "/options") return { warehouses: [], employees: [{ id: 2, name: "Budi", position: "Kurir" }] };
    if (path.startsWith("/pickups")) return [{ ...task, pickupCode: "PUP-1", pickupAddress: "Jalan Merdeka 10" }];
    if (path.startsWith("/deliveries")) return [{ ...task, deliveryCode: "DLV-1", address: "Jalan Sudirman 20" }];
    if (path.startsWith("/return-tasks")) return [{ id: 1, returnTaskCode: "RT-1", status: "CREATED", origin: "Banda Aceh", destination: "Medan", vehicleNumber: "BK-1234", originalTransportId: 4, originalTransportCode: "TRP-4", createdAt: "2026-10-17" }];
    return [];
  });
});

it("retains pickup scan actions and address in the responsive task card", async () => {
  render(<PickupsPage />);
  const user = userEvent.setup();
  await screen.findAllByText("PUP-1");
  const card = screen.getByRole("article");
  expect(within(card).getByText("Jalan Merdeka 10")).toBeInTheDocument();
  expect(within(card).getByText("1/2")).toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Detail Foto" })).not.toBeInTheDocument();
  await user.click(within(card).getByRole("button", { name: "Proses / Scan QR" }));
  expect(screen.getByRole("dialog", { name: "Scan task" })).toHaveTextContent("PUP-1");
});

it("opens delivery package details from the responsive task card", async () => {
  render(<DeliveriesPage />);
  const user = userEvent.setup();
  await screen.findAllByText("DLV-1");
  const card = screen.getByRole("article");
  expect(within(card).getByText("Jalan Sudirman 20")).toBeInTheDocument();
  await user.click(within(card).getByRole("button", { name: "Lihat detail barang DLV-1" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("PKG-1");
  expect(screen.getByRole("dialog")).toHaveTextContent("Karton");
});

it("preserves return-task approval and the original transport link in cards", async () => {
  render(<ReturnTasksPage />);
  const user = userEvent.setup();
  await screen.findAllByText("RT-1");
  const card = screen.getByRole("article");
  expect(within(card).getByRole("link", { name: "TRP-4" })).toHaveAttribute("href", "/#/transports/4");
  await user.click(within(card).getByRole("button", { name: "Setujui" }));
  expect(m.post).toHaveBeenCalledWith("/return-tasks/1/approve", {});
});
