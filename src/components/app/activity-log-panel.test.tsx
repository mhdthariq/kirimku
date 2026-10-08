// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLogPanel } from "./activity-log-panel";

const mocks = vi.hoisted(() => ({ get: vi.fn(), allowed: true }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/client-api", () => ({ apiGetWithMeta: mocks.get, hasPermission: () => mocks.allowed }));

beforeEach(() => {
  mocks.allowed = true;
  mocks.get.mockReset().mockResolvedValue({ data: [], meta: { total: 0 } });
});

describe("ActivityLogPanel", () => {
  it("does not fetch or render audit data without permission", async () => {
    mocks.allowed = false;
    const { container } = render(<ActivityLogPanel entityTypes={["shipment"]} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("regression: equivalent inline filters do not refetch, but changing the entity does", async () => {
    const { rerender } = render(<ActivityLogPanel entityTypes={["shipment"]} entityId={1} />);
    await screen.findByText("0 entri");
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/audit-logs?entityType=shipment&entityId=1&limit=30");
    rerender(<ActivityLogPanel entityTypes={["shipment"]} entityId={1} />);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    rerender(<ActivityLogPanel entityTypes={["shipment"]} entityId={2} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(mocks.get).toHaveBeenLastCalledWith("/audit-logs?entityType=shipment&entityId=2&limit=30");
    await screen.findByText("Belum ada aktivitas tercatat untuk menu ini.");
  });

  it("shows fetch errors and allows retrying to recover", async () => {
    mocks.get.mockRejectedValueOnce(new Error("Audit unavailable"));
    render(<ActivityLogPanel entityTypes={["shipment"]} />);
    await screen.findByText("Audit unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Muat ulang log" }));
    await screen.findByText("0 entri");
    expect(screen.queryByText("Audit unavailable")).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
