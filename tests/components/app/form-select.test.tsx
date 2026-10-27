// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field, FormSelect } from "@/components/app/form-parts";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const options = [
  { value: "1", label: "Jakarta" },
  { value: "2", label: "Surabaya" },
  { value: "3", label: "Bandung" },
  { value: "4", label: "Jakarta" },
];

function Picker({ disabled = false, required = false }: { disabled?: boolean; required?: boolean }) {
  const [value, setValue] = useState("");
  return <Field label="Kota" htmlFor="city"><FormSelect id="city" value={value} onValueChange={setValue} options={options} disabled={disabled} required={required} /></Field>;
}

describe("searchable FormSelect", () => {
  it("filters by label, selects the original value, and resets search on reopen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FormSelect ariaLabel="Kota" value="1" onValueChange={onChange} options={options} />);
    const trigger = screen.getByRole("combobox", { name: "Kota" });
    expect(trigger).toHaveTextContent("Jakarta");
    await user.click(trigger);
    await user.type(screen.getByRole("combobox", { name: "Cari opsi" }), "SURABAYA");
    expect(screen.queryByRole("option", { name: "Bandung" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Surabaya" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(screen.getByRole("combobox", { name: "Cari opsi" })).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("handles no matches, keyboard selection, and Escape without clearing the selection", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("combobox", { name: "Kota" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const search = screen.getByRole("combobox", { name: "Cari opsi" });
    await user.type(search, "unknown city");
    expect(screen.getByText("Tidak ada opsi ditemukan.")).toBeVisible();
    await user.clear(search);
    await user.type(search, "Bandung");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(trigger).toHaveTextContent("Bandung");
    await user.click(trigger);
    await user.type(screen.getByRole("combobox", { name: "Cari opsi" }), "Surabaya");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Bandung");
  });

  it("cannot open a disabled picker", async () => {
    const user = userEvent.setup();
    render(<Picker disabled />);
    const trigger = screen.getByRole("combobox", { name: "Kota" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("preserves required validation until an option is selected", async () => {
    const user = userEvent.setup();
    const { container } = render(<form><Picker required /></form>);
    const form = container.querySelector("form")!;
    act(() => { expect(form.checkValidity()).toBe(false); });
    await user.click(screen.getByRole("option", { name: "Bandung" }));
    expect(form.checkValidity()).toBe(true);
  });

  it("opens only the first empty required control when a form is invalid", () => {
    const { container } = render(<form>
      <FormSelect ariaLabel="Asal" value="" onValueChange={() => {}} options={options} required />
      <FormSelect ariaLabel="Tujuan" value="" onValueChange={() => {}} options={options} required />
    </form>);
    act(() => { expect(container.querySelector("form")!.checkValidity()).toBe(false); });
    expect(screen.getByRole("combobox", { name: "Asal" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Tujuan" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
  });

  it("searches and selects inside a modal without closing it or submitting its form", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Pilih kota</DialogTitle><form onSubmit={onSubmit}><Picker /></form></DialogContent></Dialog>);
    await user.click(screen.getByRole("combobox", { name: "Kota" }));
    await user.type(screen.getByRole("combobox", { name: "Cari opsi" }), "Surabaya");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox", { name: "Kota" })).toHaveTextContent("Surabaya");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "Kota" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
