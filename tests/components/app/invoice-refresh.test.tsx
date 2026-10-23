// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), billed: false }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: true } }) }));
vi.mock("@/infrastructure/http/client-api", async original => ({
  ...await original<typeof import("@/infrastructure/http/client-api")>(), apiGet: m.get, apiPost: m.post,
}));
vi.mock("@/components/app/form-parts", async original => ({
  ...await original<typeof import("@/components/app/form-parts")>(),
  FormSelect: ({ value, onValueChange, options, placeholder, disabled }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[]; placeholder: string; disabled?: boolean }) =>
    <select aria-label={placeholder} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">{placeholder}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock("@/components/app/activity-log-panel", () => ({ ActivityLogPanel: () => null }));
import { InvoicesPage } from "@/components/app/pages/invoices-page";

beforeEach(() => {
  vi.clearAllMocks();
  m.billed = false;
  m.get.mockImplementation(async (path: string) => path === "/options" ? {
    customers: [{ id: 2, name: "Customer", companyName: "Company", type: "b2b" }],
    b2bShipments: [{ id: 3, masterCode: "MS-3", customerId: 2, origin: "Jakarta", destination: "Bandung", priceAmount: 100, invoiceLines: m.billed ? [{ invoice: { id: 1 } }] : [] }],
  } : []);
  m.post.mockImplementation(async () => { m.billed = true; return { id: 1 }; });
});

it("refreshes eligible shipments after creating an invoice without a page reload", async () => {
  const user = userEvent.setup();
  render(<InvoicesPage />);
  await user.click(screen.getByRole("button", { name: "Buat Invoice" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "Pilih customer…" }), { target: { value: "2" } });
  await user.click(await screen.findByRole("button", { name: "Add Shipment" }));
  const picker = screen.getByRole("dialog", { name: "Add Shipment" });
  await user.click(await within(picker).findByRole("button", { name: /MS-3/ }));
  await user.click(screen.getByRole("button", { name: "Buat Invoice Draft" }));
  await waitFor(() => expect(m.post).toHaveBeenCalledWith("/invoices", expect.objectContaining({ lines: [expect.objectContaining({ shipmentId: 3 })] })));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Buat Invoice" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "Pilih customer…" }), { target: { value: "2" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add Shipment" })).toBeDisabled());
  expect(screen.queryByDisplayValue(/MS-3/)).not.toBeInTheDocument();
});
