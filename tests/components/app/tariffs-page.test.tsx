// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TariffsPage } from "@/components/app/pages/tariffs-page";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { permissions: ["tariff.view"], isOwner: false } }) }));
vi.mock("@/infrastructure/http/client-api", async (original) => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: m.get,
}));
const base = { origin: "Medan", destination: "Banda Aceh", customerType: "b2c", ratePerKg: 1000, minChargeableKg: 1, effectiveFrom: "2026-01-01", effectiveTo: null };
beforeEach(() => {
  m.get.mockImplementation(async (path: string) => path === "/options" ? { customers: [] } : [
    { ...base, id: 1, name: "Tarif Baru", isActive: true },
    { ...base, id: 2, name: "Tarif Lama", isActive: false },
  ]);
});

it("defaults to Aktif, filters All and Nonaktif, and removes the status column", async () => {
  render(<TariffsPage />);
  const user = userEvent.setup();
  await screen.findAllByText("Tarif Baru");
  expect(screen.queryByText("Tarif Lama")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aktif" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getAllByText("Tarif Lama").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Tarif Baru").length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Nonaktif" }));
  expect(screen.queryByText("Tarif Baru")).not.toBeInTheDocument();
  expect(screen.getAllByText("Tarif Lama").length).toBeGreaterThan(0);
  await user.type(screen.getByPlaceholderText("Cari nama / koridor…"), "missing");
  await waitFor(() => expect(screen.queryByText("Tarif Lama")).not.toBeInTheDocument());
  expect(screen.getByText(/Tidak ada tarif B2C/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reset Filter" }));
  expect(screen.getByRole("button", { name: "Aktif" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox", { name: "Cari tarif" })).toHaveValue("");
  expect(screen.getByRole("article", { name: /Tarif Baru/ })).toBeInTheDocument();
  expect(screen.queryByText("Tarif Lama")).not.toBeInTheDocument();
});
