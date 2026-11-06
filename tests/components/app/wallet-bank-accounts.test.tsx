// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { partnerType: "MARKETING", permissions: [] } }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get, hasPermission: () => false }));

import { WalletPage } from "@/components/app/pages/wallet-page";

beforeEach(() => {
  vi.clearAllMocks();
  m.get.mockImplementation(async (url: string) => {
    if (url === "/wallet") return { balance: 0, reserved: 0, available: 0, profitShare: { partner: 20, company: 80 }, bank: null };
    if (url === "/topups") return { topUps: [], bankAccounts: [] };
    return [];
  });
});

describe("wallet top-up bank accounts", () => {
  it("shows an empty state without a placeholder account", async () => {
    render(<WalletPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Top Up" }));
    expect(await screen.findByText("Belum ada rekening perusahaan aktif. Hubungi Admin Kantor.")).toBeInTheDocument();
    expect(screen.queryByText("123-00-4567890")).not.toBeInTheDocument();
  });

  it("shows every active account returned by the API", async () => {
    m.get.mockImplementation(async (url: string) => {
      if (url === "/wallet") return { balance: 0, reserved: 0, available: 0, profitShare: { partner: 20, company: 80 }, bank: null };
      if (url === "/topups") return { topUps: [], bankAccounts: [
        { id: 1, bankName: "BCA", accountNumber: "00123456", accountName: "Company A" },
        { id: 2, bankName: "BNI", accountNumber: "00987654", accountName: "Company B" },
      ] };
      return [];
    });
    render(<WalletPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Top Up" }));
    for (const text of ["BCA", "00123456", "Company A", "BNI", "00987654", "Company B"]) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText("Belum ada rekening perusahaan aktif. Hubungi Admin Kantor.")).not.toBeInTheDocument();
  });
});
