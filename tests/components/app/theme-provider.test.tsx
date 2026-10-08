// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../../src/components/app/theme-provider";

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return <>
    <output>{theme}:{resolvedTheme}</output>
    <button onClick={() => setTheme("dark")}>Dark</button>
  </>;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

describe("ThemeProvider", () => {
  it("resolves system to dark when system support is enabled", () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("system:dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("resolves system to light when system support is disabled", () => {
    render(<ThemeProvider enableSystem={false}><ThemeProbe /></ThemeProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("system:light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("preserves an explicit stored theme instead of the system preference", () => {
    window.localStorage.setItem("theme", "light");
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("light:light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("applies and persists explicit theme changes", async () => {
    render(<ThemeProvider defaultTheme="light"><ThemeProbe /></ThemeProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("status")).toHaveTextContent("dark:dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});
