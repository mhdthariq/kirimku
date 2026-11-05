// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OpenableImage } from "@/components/ui/openable-image";

afterEach(() => vi.restoreAllMocks());

it("uses a navigable blob URL and releases it when replaced or unmounted", () => {
  const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const { rerender, unmount } = render(<OpenableImage src="data:image/png;base64,YQ==" alt="Vehicle" />);
  expect(screen.getByAltText("Vehicle")).toHaveAttribute("src", "blob:first");
  expect(create.mock.calls[0][0].type).toBe("image/png");
  expect(create.mock.calls[0][0].size).toBe(1);
  rerender(<OpenableImage src="data:image/jpeg;base64,Yg==" alt="Vehicle" />);
  expect(screen.getByAltText("Vehicle")).toHaveAttribute("src", "blob:second");
  expect(revoke).toHaveBeenCalledWith("blob:first");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:second");
});

it("preserves ordinary URLs and handles missing or malformed sources", () => {
  const { rerender } = render(<OpenableImage src="/truck.png" alt="Vehicle" />);
  expect(screen.getByAltText("Vehicle")).toHaveAttribute("src", "/truck.png");
  rerender(<OpenableImage src="data:image/png;base64,!!!" alt="Vehicle" />);
  expect(screen.getByAltText("Vehicle")).toHaveAttribute("src", "data:image/png;base64,!!!");
  rerender(<OpenableImage alt="Vehicle" />);
  expect(screen.getByAltText("Vehicle")).not.toHaveAttribute("src");
});
