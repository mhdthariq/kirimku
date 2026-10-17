// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "@/infrastructure/http/client-api";

const m = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), refresh: vi.fn(), owner: false }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { isOwner: m.owner }, refreshUser: m.refresh }) }));
vi.mock("@/infrastructure/http/client-api", () => ({ apiGet: m.get, apiPut: m.put, hasPermission: () => true }));
vi.mock("@/components/app/capacity-settings-card", () => ({ CapacitySettingsCard: () => <div>Pengaturan Kapasitas</div> }));
import { ProfilePage } from "@/components/app/pages/profile-page";

const profile: ProfileData = {
  id: 1, name: "Andi Pratama", username: "andi", isOwner: false,
  roles: [{ name: "Marketing", slug: "marketing" }],
  warehouse: { name: "Gudang Medan", city: "Medan" },
  partner: {
    id: 2, type: "MARKETING", profitShare: { company: 80, partner: 20 },
    bank: { bankName: "Mandiri", bankAccountName: "Andi Pratama", bankAccountNumber: "0012345678" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.owner = false;
  m.get.mockResolvedValue(profile);
  m.put.mockResolvedValue({});
});

describe("Profil redesign", () => {
  it("renders account sections and saves partner bank details with leading zeroes", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByRole("heading", { name: "Informasi Pribadi" });
    expect(screen.getByRole("heading", { name: "Keamanan Akun" })).toBeInTheDocument();
    expect(screen.getByText("Gudang Medan · Medan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Buka Wallet/ })).toHaveAttribute("href", "#/wallet");
    expect(screen.getByLabelText("Nomor Rekening")).toHaveValue("0012345678");
    await user.click(screen.getByRole("button", { name: /Simpan Rekening/ }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith("/profile", profile.partner!.bank));
  });

  it("preserves owner identity updates and capacity settings", async () => {
    m.owner = true;
    m.get.mockResolvedValue({ ...profile, isOwner: true, partner: null });
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByLabelText("Nama Tampilan");
    expect(screen.getByText("Pengaturan Kapasitas")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nomor Rekening")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Nama Tampilan"));
    await user.type(screen.getByLabelText("Nama Tampilan"), "Andi Baru");
    await user.click(screen.getByRole("button", { name: /Simpan Nama/ }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith("/profile", { name: "Andi Baru", username: "andi" }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it("blocks mismatched passwords and clears the fields after a successful update", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByLabelText("Password Saat Ini");
    await user.type(screen.getByLabelText("Password Saat Ini"), "old-password");
    await user.type(screen.getByLabelText("Password Baru"), "new-password");
    await user.type(screen.getByLabelText("Konfirmasi Password Baru"), "different");
    expect(screen.getByText("Konfirmasi tidak cocok.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ubah Password/ })).toBeDisabled();
    expect(m.put).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Konfirmasi Password Baru"));
    await user.type(screen.getByLabelText("Konfirmasi Password Baru"), "new-password");
    await user.click(screen.getByRole("button", { name: /Ubah Password/ }));
    await waitFor(() => expect(m.put).toHaveBeenCalledWith("/profile", { currentPassword: "old-password", newPassword: "new-password" }));
    await waitFor(() => expect(screen.getByLabelText("Password Baru")).toHaveValue(""));
  });
});
