// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  m.get.mockImplementation(async (path: string) => path === "/vehicles" ? [vehicle] : path === "/options" ? { vehicleOwners: [] } : null);
  m.post.mockResolvedValue({ id: 2 });
  m.put.mockResolvedValue(vehicle);
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
  await waitFor(() => expect(m.post).toHaveBeenCalledWith("/vehicles", expect.objectContaining({ vehicleNumber: "B 5678 YY", photoDataUrl: preview.getAttribute("src") })));
});

it("preserves an existing photo on edit and supports explicit removal", async () => {
  const user = userEvent.setup();
  render(<VehiclesPage />);
  await user.click((await screen.findAllByRole("button", { name: "Edit B 1234 XX" }))[0]);
  expect(screen.getByRole("img", { name: "Preview kendaraan" })).toHaveAttribute("src", photo);
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
  expect(screen.getByRole("img", { name: "Preview kendaraan" })).toHaveAttribute("src", photo);
  await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
  await waitFor(() => expect(m.put).toHaveBeenCalledWith("/vehicles/1", expect.objectContaining({ photoDataUrl: photo })));
});
