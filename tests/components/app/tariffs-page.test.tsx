// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
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
    { ...base, id: 3, name: "Tarif Bisnis", customerType: "b2b", isActive: true, customer: { id: 8, name: "PIC", companyName: "Sumatra Jaya" }, pricingMethod: "PER_CUBIC", ratePerCubic: 185000 },
  ]);
});

it("switches between table and cards without losing search or status filters", async () => {
  render(<TariffsPage />);
  const user = userEvent.setup();
  await screen.findByRole("article", { name: /Tarif Baru/ });
  expect(screen.getByRole("button", { name: "Card" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "All" }));
  await user.type(screen.getByRole("textbox", { name: "Cari tarif" }), "Lama");
  await user.click(screen.getByRole("button", { name: "Table" }));
  const table = screen.getByRole("table", { name: "Tarif B2C" });
  expect(within(table).getByText("Tarif Lama")).toBeInTheDocument();
  expect(within(table).queryByText("Tarif Baru")).not.toBeInTheDocument();
  expect(within(table).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
  expect(within(table).queryByRole("columnheader", { name: "Aksi" })).not.toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Card" }));
  expect(screen.getByRole("article", { name: /Tarif Lama/ })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Cari tarif" })).toHaveValue("Lama");
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("keeps the table choice across B2C and B2B tabs and displays business pricing", async () => {
  render(<TariffsPage />);
  const user = userEvent.setup();
  await screen.findByRole("article", { name: /Tarif Baru/ });
  await user.click(screen.getByRole("button", { name: "Table" }));
  await user.click(screen.getByRole("tab", { name: /B2B/ }));
  const table = screen.getByRole("table", { name: "Tarif B2B" });
  expect(within(table).getByRole("columnheader", { name: "Customer" })).toBeInTheDocument();
  expect(within(table).getByText("Sumatra Jaya")).toBeInTheDocument();
  expect(within(table).getByText("Rp185.000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
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
