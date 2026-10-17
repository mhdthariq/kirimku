// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo, LogoMark } from "@/components/app/logo";

describe("NovaLogistik branding", () => {
  it("provides light and dark icons controlled by the app theme class", () => {
    render(<LogoMark />);
    const icons = screen.getAllByAltText("Logo NovaLogistik");
    expect(icons).toHaveLength(2);
    expect(icons[0]).toHaveAttribute("src", expect.stringContaining("nova-icon-light.png"));
    expect(icons[0]).toHaveClass("dark:hidden");
    expect(icons[1]).toHaveAttribute("src", expect.stringContaining("nova-icon-dark.png"));
    expect(icons[1]).toHaveClass("hidden", "dark:block");
  });

  it("shows the renamed brand and accessible home link", () => {
    render(<Logo />);
    expect(screen.getByRole("link", { name: "NovaLogistik - beranda" })).toHaveAttribute("href", "#/dashboard");
    expect(screen.getByText("Nova", { exact: false }).textContent).toBe("NovaLogistik");
  });

  it("keeps the compact logo icon-only", () => {
    render(<Logo compact />);
    expect(screen.queryByText("Logistik")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NovaLogistik - beranda" })).toBeInTheDocument();
  });
});
