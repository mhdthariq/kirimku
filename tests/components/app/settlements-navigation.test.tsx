// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: true } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), hasPermission: () => true }));
vi.mock("@/hooks/use-api-data", () => ({ useApiData: () => ({ data: [], loading: false, reload: vi.fn() }), runAction: vi.fn() }));
import { SettlementsPage } from "@/components/app/pages/settlements-page";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

describe("Partner Settlements tab navigation", () => {
  it.each([
    ["transport", "Settlement Transport"],
    ["commission", "Komisi B2B Marketing"],
    ["unknown", "Settlement Transport"],
    ["", "Settlement Transport"],
  ])("opens the expected tab for %s", (tab, name) => {
    window.history.replaceState(null, "", `/#/settlements?tab=${tab}`);
    render(<SettlementsPage />);
    expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  });

  it("updates the URL on tab selection and responds to hash navigation", async () => {
    window.history.replaceState(null, "", "/#/settlements?tab=transport");
    render(<SettlementsPage />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Komisi B2B Marketing" }));
    await waitFor(() => expect(window.location.hash).toBe("#/settlements?tab=commission"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Komisi B2B Marketing" })).toHaveAttribute("aria-selected", "true"));
    window.history.replaceState(null, "", "/#/settlements?tab=transport");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.getByRole("tab", { name: "Settlement Transport" })).toHaveAttribute("aria-selected", "true");
  });
});
