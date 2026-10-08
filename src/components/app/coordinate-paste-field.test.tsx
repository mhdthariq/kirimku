// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CoordinatePasteField } from "./coordinate-paste-field";

const label = "Coordinates";
const invalidMessage = "Format tidak dikenali - contoh: -6.914744, 107.609810";

function ControlledField() {
  const [point, setPoint] = useState<[number | null, number | null]>([null, null]);
  return <CoordinatePasteField label={label} latitude={point[0]} longitude={point[1]}
    onChange={(lat, lng) => setPoint([lat, lng])} />;
}

describe("CoordinatePasteField", () => {
  it("parses pasted coordinates and preserves their formatting after the parent update", () => {
    render(<ControlledField />);
    const input = screen.getByRole("textbox", { name: label });
    const pasted = "-6.914744, 107.609810";
    fireEvent.change(input, { target: { value: pasted } });
    expect(input).toHaveValue(pasted);
    expect(screen.getByTitle("Buka di Google Maps")).toHaveAttribute("href", expect.stringContaining("-6.914744"));
    expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
  });

  it("keeps invalid input visible without publishing an invalid point", () => {
    const onChange = vi.fn();
    render(<CoordinatePasteField label={label} latitude={null} longitude={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not coordinates" } });
    expect(screen.getByRole("textbox")).toHaveValue("not coordinates");
    expect(screen.getByText(invalidMessage)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Buka di Google Maps")).not.toBeInTheDocument();
  });

  it("regression: an external map selection replaces invalid text and clears its stale error", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CoordinatePasteField label={label} latitude={null} longitude={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "invalid" } });
    rerender(<CoordinatePasteField label={label} latitude={-6.2} longitude={106.8} onChange={onChange} />);
    expect(screen.getByRole("textbox")).toHaveValue("-6.200000, 106.800000");
    expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears both coordinates and removes the map link when the input is emptied", async () => {
    render(<ControlledField />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "-6.2, 106.8" } });
    await userEvent.setup().clear(input);
    expect(input).toHaveValue("");
    expect(screen.queryByTitle("Buka di Google Maps")).not.toBeInTheDocument();
    expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
  });

  it("does not allow editing when disabled", async () => {
    const onChange = vi.fn();
    render(<CoordinatePasteField label={label} latitude={null} longitude={null} onChange={onChange} disabled />);
    const input = screen.getByRole("textbox");
    await userEvent.setup().type(input, "-6.2, 106.8");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
