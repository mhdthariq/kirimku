// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: true } }) }));
vi.mock("@/infrastructure/http/client-api", async original => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: m.get, apiPost: m.post, apiPut: m.put,
}));
vi.mock("@/components/app/activity-log-panel", () => ({ ActivityLogPanel: () => null }));
import { VehiclesPage } from "@/components/app/pages/vehicles-page";

const photo = "data:image/png;base64,AAAA";
const vehicle = { id: 1, vehicleNumber: "B 1234 XX", name: "Truck", status: "ACTIVE", maxWeightKg: 3500, maxVolumeM3: 14, photoDataUrl: photo };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:vehicle-photo"), revokeObjectURL: vi.fn() }));
  m.get.mockImplementation(async (path: string) => path === "/vehicles" ? [vehicle] : path === "/options" ? { vehicleOwners: [] } : null);
  m.post.mockResolvedValue({ id: 2 });
  m.put.mockResolvedValue(vehicle);
});

it("switches between Card and Table while preserving search and vehicle actions", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  const card = await screen.findByRole("article", { name: "Kendaraan B 1234 XX" });
  expect(within(card).getByText("3.500 kg")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Edit B 1234 XX" })).toBeInTheDocument();
  const views = within(screen.getByRole("group", { name: "Tampilan kendaraan" }));
  expect(views.getByRole("button", { name: "Card" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("Cari nopol / nama…"), "1234");
  await user.click(views.getByRole("button", { name: "Table" }));
  expect(within(screen.getByRole("table")).getByText("B 1234 XX")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("Cari nopol / nama…")).toHaveValue("1234");
  await user.click(views.getByRole("button", { name: "Card" }));
  await user.click(screen.getByRole("button", { name: "Edit B 1234 XX" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("keeps search and view controls available with no matching vehicles", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  await screen.findByRole("article", { name: "Kendaraan B 1234 XX" });
  await user.type(screen.getByPlaceholderText("Cari nopol / nama…"), "missing");
  await user.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("Cari nopol / nama…")).toHaveValue("missing");
  await user.clear(screen.getByPlaceholderText("Cari nopol / nama…"));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("previews an uploaded photo and submits it with the new vehicle", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  await user.click(screen.getByRole("button", { name: "Tambah Kendaraan" }));
  fireEvent.change(screen.getByRole("group", { name: "Upload atau tempel foto" }).querySelector("input")!, { target: { files: [new File(["photo"], "truck.png", { type: "image/png" })] } });
  const preview = await screen.findByRole("img", { name: "Preview kendaraan" });
  await user.type(screen.getByLabelText("Nomor Polisi"), "B 5678 YY");
  await user.type(screen.getByLabelText("Max Berat (kg)"), "3500");
  await user.type(screen.getByLabelText("Max Volume (m³)"), "14");
  await user.click(screen.getByRole("button", { name: "Buat Kendaraan" }));
  expect(preview).toHaveAttribute("src", "blob:vehicle-photo");
  await waitFor(() => expect(m.post).toHaveBeenCalledWith("/vehicles", expect.objectContaining({ vehicleNumber: "B 5678 YY", photoDataUrl: "data:image/png;base64,cGhvdG8=" })));
});

it("preserves an existing photo on edit and supports explicit removal", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  await user.click((await screen.findAllByRole("button", { name: "Edit B 1234 XX" }))[0]);
  expect(screen.getByRole("img", { name: "Preview kendaraan" })).toHaveAttribute("src", "blob:vehicle-photo");
  await user.click(screen.getByRole("button", { name: "Hapus foto" }));
  expect(screen.queryByRole("img", { name: "Preview kendaraan" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(m.put).toHaveBeenCalledWith("/vehicles/1", expect.objectContaining({ photoDataUrl: null })));
});

it("rejects oversized photos without replacing the saved preview", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  await user.click((await screen.findAllByRole("button", { name: "Edit B 1234 XX" }))[0]);
  fireEvent.change(screen.getByRole("group", { name: "Upload atau tempel foto" }).querySelector("input")!, { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
  expect(screen.getByRole("img", { name: "Preview kendaraan" })).toHaveAttribute("src", "blob:vehicle-photo");
  await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(m.put).toHaveBeenCalledWith("/vehicles/1", expect.objectContaining({ photoDataUrl: photo })));
});
