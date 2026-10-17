// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RepairsPage } from "@/components/app/pages/repairs-page";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), permissions: ["repair.view", "repair.create"] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { permissions: m.permissions, isOwner: false } }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: m.get, apiPost: m.post,
}));
// Keep the selector native in jsdom; exercise the page's options and controlled state.
vi.mock("@/components/app/form-parts", async (original) => ({
  ...await original<typeof import("@/components/app/form-parts")>(),
  FormSelect: ({ id, value, onValueChange, options, disabled }: {
    id?: string; value: string; onValueChange: (value: string) => void;
    options: { value: string; label: string }[]; disabled?: boolean;
  }) => <select id={id} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
    <option value="">Pilih kendaraan…</option>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));
const vehicles = [
  { id: 1, vehicleNumber: "B 1000 CO", ownerId: null },
  { id: 2, vehicleNumber: "B 2000 PA", ownerId: 9 },
];
beforeEach(() => {
  vi.resetAllMocks();
  m.permissions = ["repair.view", "repair.create"];
  m.get.mockImplementation(async (path: string) => path === "/repairs/vehicles" ? vehicles : []);
  m.post.mockResolvedValue({ id: 3 });
});
async function openForm() {
  const user = userEvent.setup();
  render(<RepairsPage />);
  await user.click(screen.getByRole("button", { name: "Catat Repair" }));
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(within(dialog).queryByText("Memuat kendaraan…")).not.toBeInTheDocument());
  return { user, dialog, select: within(dialog).getByRole("combobox", { name: "Kendaraan" }) };
}

it("loads repair-specific choices and separates company and partner vehicles by ownerId", async () => {
  const { user, dialog, select } = await openForm();
  expect(m.get).toHaveBeenCalledWith("/repairs/vehicles");
  expect(m.get).not.toHaveBeenCalledWith("/vehicles");
  expect(within(select).getByRole("option", { name: "B 2000 PA" })).toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: "B 1000 CO" })).not.toBeInTheDocument();
  await user.selectOptions(select, "2");
  await user.click(within(dialog).getByRole("tab", { name: "Kendaraan Perusahaan" }));
  expect(select).toHaveValue("");
  expect(within(select).getByRole("option", { name: "B 1000 CO" })).toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: "B 2000 PA" })).not.toBeInTheDocument();
  expect(within(dialog).getByText(/Biaya repair ditanggung perusahaan/)).toBeInTheDocument();
  await user.selectOptions(select, "1");
  fireEvent.submit(select.closest("form")!);
  expect(m.post).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("tab", { name: "Kendaraan Partner" }));
  expect(select).toHaveValue("");
});

it.each([
  { tab: "Kendaraan Partner", vehicleId: 2 },
  { tab: "Kendaraan Perusahaan", vehicleId: 1 },
])("submits $tab with proof and resets on reopening", async ({ tab, vehicleId }) => {
  const { user, dialog, select } = await openForm();
  await user.click(within(dialog).getByRole("tab", { name: tab }));
  await user.selectOptions(select, String(vehicleId));
  expect(within(dialog).getByRole("button", { name: "Simpan & Verifikasi" })).toBeDisabled();
  await user.type(within(dialog).getByPlaceholderText("mis. Ganti oli + servis rem"), "Ganti oli");
  await user.type(within(dialog).getByRole("spinbutton"), "150000");
  const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, new File(["proof"], "nota.pdf", { type: "application/pdf" }));
  const submit = within(dialog).getByRole("button", { name: "Simpan & Verifikasi" });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  await waitFor(() => expect(m.post).toHaveBeenCalledWith("/repairs", expect.objectContaining({
    vehicleId, description: "Ganti oli", amount: 150000, proofUrl: expect.stringContaining("data:application/pdf;base64,"),
  })));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Catat Repair" }));
  expect(screen.getByRole("combobox", { name: "Kendaraan" })).toHaveValue("");
});

it("shows an explicit empty state for each ownership group", async () => {
  m.get.mockResolvedValue([]);
  const { user, dialog, select } = await openForm();
  expect(within(dialog).getByText("Belum ada kendaraan partner.")).toBeInTheDocument();
  expect(select).toBeDisabled();
  await user.click(within(dialog).getByRole("tab", { name: "Kendaraan Perusahaan" }));
  expect(within(dialog).getByText("Belum ada kendaraan perusahaan.")).toBeInTheDocument();
});

it("distinguishes request failures from empty lists and allows retry", async () => {
  m.get.mockImplementation(async (path: string) => {
    if (path === "/repairs/vehicles") throw new Error("Tidak diizinkan");
    return [];
  });
  const { user, dialog, select } = await openForm();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Gagal memuat kendaraan: Tidak diizinkan");
  expect(select).toBeDisabled();
  expect(within(dialog).queryByText("Belum ada kendaraan partner.")).not.toBeInTheDocument();
  m.get.mockImplementation(async (path: string) => path === "/repairs/vehicles" ? vehicles : []);
  await user.click(within(dialog).getByRole("button", { name: "Coba lagi" }));
  await waitFor(() => expect(select).toBeEnabled());
  expect(within(select).getByRole("option", { name: "B 2000 PA" })).toBeInTheDocument();
});

it("does not fetch creation choices for read-only repair users", async () => {
  m.permissions = ["repair.view"];
  render(<RepairsPage />);
  await waitFor(() => expect(m.get).toHaveBeenCalledWith("/repairs"));
  expect(m.get).not.toHaveBeenCalledWith("/repairs/vehicles");
  expect(screen.queryByRole("button", { name: "Catat Repair" })).not.toBeInTheDocument();
});

it("labels company repair list, details, editing and deletion without partner accounting claims", async () => {
  m.permissions = ["repair.view", "repair.update", "repair.delete"];
  const companyRepair = {
    id: 1, repairCode: "REP-CO", vehicleId: 1, ownerId: null,
    description: "Servis perusahaan", amount: 150000, deductedAmount: 0,
    repairDate: "2026-10-17", createdAt: "2026-10-17", status: "VERIFIED",
    vehicle: { id: 1, vehicleNumber: "B 1000 CO", name: null }, owner: null,
    workshopVendor: null, notes: null, proofUrl: "data:application/pdf;base64,cHJvb2Y=",
  };
  m.get.mockImplementation(async (path: string) => path === "/repairs" ? [companyRepair] : []);
  const user = userEvent.setup();
  render(<RepairsPage />);
  expect((await screen.findAllByText("Ditanggung perusahaan")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Perusahaan").length).toBeGreaterThan(0);
  await user.click(screen.getAllByRole("button", { name: "Detail" })[0]);
  expect(within(screen.getByRole("dialog")).getByText(/Servis perusahaan.*ditanggung perusahaan/)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText("Terverifikasi · Ditanggung perusahaan")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  expect(within(screen.getByRole("dialog")).getByText(/Biaya ditanggung perusahaan tanpa perubahan wallet partner/)).toBeInTheDocument();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Batal" }));
  await user.click(screen.getAllByRole("button", { name: "Hapus" })[0]);
  const confirmation = screen.getByRole("alertdialog");
  expect(within(confirmation).getByText(/tanpa perubahan wallet partner/)).toBeInTheDocument();
  expect(within(confirmation).queryByText(/dikembalikan ke wallet/)).not.toBeInTheDocument();
});
