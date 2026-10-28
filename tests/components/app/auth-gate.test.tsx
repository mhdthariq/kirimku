// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/app/auth-gate";

const auth = vi.hoisted(() => ({ loading: false, user: null as null | { id: number } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));
vi.mock("@/components/app/login-screen", () => ({
  LoginScreen: () => <main aria-label="Login">Login form</main>,
}));

describe("AuthGate layout", () => {
  it("shows only the login screen when signed out, without an introduction above it", () => {
    auth.loading = false;
    auth.user = null;
    const { container } = render(<AuthGate><p>Dashboard</p></AuthGate>);

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(screen.getByRole("main", { name: "Login" }));
    expect(screen.queryByLabelText("Tentang layanan")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("shows only the session loader while loading", () => {
    auth.loading = true;
    auth.user = null;
    const { container } = render(<AuthGate><p>Dashboard</p></AuthGate>);

    expect(container.children).toHaveLength(1);
    expect(screen.getByText("Memuat sesi…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tentang layanan")).not.toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Login" })).not.toBeInTheDocument();
  });

  it("shows the protected content after login", () => {
    auth.loading = false;
    auth.user = { id: 1 };
    const { container } = render(<AuthGate><main>Dashboard</main></AuthGate>);

    expect(container.children).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveTextContent("Dashboard");
    expect(screen.queryByLabelText("Tentang layanan")).not.toBeInTheDocument();
  });
});
