// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PasteFileInput } from "@/components/ui/paste-file-input";
afterEach(() => vi.unstubAllGlobals());
it("passes pasted photos through the existing change handler", () => {
  const file = new File(["photo"], "pasted.png", { type: "image/png" });
  vi.stubGlobal("DataTransfer", class { files: File[] = []; items = { add: (f: File) => this.files.push(f) }; });
  const changed = vi.fn();
  const { container } = render(<PasteFileInput type="file" accept="image/png" onChange={event => changed(event.target.files?.[0])} />);
  const input = container.querySelector("input")!;
  let files: unknown;
  Object.defineProperty(input, "files", { get: () => files, set: value => { files = value; }, configurable: true });
  fireEvent.paste(screen.getByRole("group"), { clipboardData: { files: [file] } });
  expect(changed).toHaveBeenCalledWith(file);
});
it("does not replace a photo with unsupported clipboard types", () => {
  const changed = vi.fn();
  render(<PasteFileInput type="file" accept="image/png" onChange={changed} />);
  fireEvent.paste(screen.getByRole("group"), { clipboardData: { files: [new File(["gif"], "image.gif", { type: "image/gif" })] } });
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("tidak didukung");
});


it("focuses the paste area inside a label without opening the picker", () => {
  render(<label>Upload<PasteFileInput native type="file" className="hidden" /></label>);
  const area = screen.getByRole("group");
  const pickerClick = vi.fn();
  area.querySelector("input")!.addEventListener("click", pickerClick);
  fireEvent.click(area.querySelector("span")!);
  expect(area).toHaveFocus();
  expect(pickerClick).not.toHaveBeenCalled();
});

it("keeps disabled uploads unchanged when pasting", () => {
  const changed = vi.fn();
  render(<PasteFileInput type="file" disabled onChange={changed} />);
  fireEvent.paste(screen.getByRole("group"), { clipboardData: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
  expect(changed).not.toHaveBeenCalled();
});
