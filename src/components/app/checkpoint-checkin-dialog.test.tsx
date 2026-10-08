// @vitest-environment jsdom

import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckpointCheckinDialog } from "./checkpoint-checkin-dialog";

vi.mock("@/lib/client-api", () => ({
  apiGet: vi.fn().mockResolvedValue({ progress: null }),
  apiPost: vi.fn(),
}));
vi.mock("@/components/app/scan-console", () => ({ ScanConsole: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness() {
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen(true)}>Reopen</button>
    <CheckpointCheckinDialog open={open} onOpenChange={setOpen} onDone={vi.fn()} transportId={1} transportCode="T1" checkpoints={[]} />
  </>;
}

const getUserMedia = vi.fn();
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

describe("CheckpointCheckinDialog camera lifetime", () => {
  it.each([false, true])("stops every track when permission resolves after dismissal (StrictMode: %s)", async (strict) => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Buka Kamera Selfie" }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A new session must not make the dismissed session's request live again.
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const stops = [vi.fn(), vi.fn()];
    const stream = { getTracks: () => stops.map((stop) => ({ stop })) } as unknown as MediaStream;
    await act(async () => { pending.resolve(stream); });
    stops.forEach((stop) => expect(stop).toHaveBeenCalledTimes(1));
    expect(play).not.toHaveBeenCalled();
    expect(document.querySelector("video")).toBeNull();
  });

  it("attaches a live stream after StrictMode effect replay and stops it on dismissal", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    render(<StrictMode><Harness /></StrictMode>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Buka Kamera Selfie" }));
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    await act(async () => { pending.resolve(stream); });
    expect(document.querySelector("video")?.srcObject).toBe(stream);
    expect(play).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("ignores a late permission rejection after dismissal", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    render(<StrictMode><Harness /></StrictMode>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Buka Kamera Selfie" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await act(async () => { pending.reject(new DOMException("Denied", "NotAllowedError")); });
    expect(screen.queryByText(/Kamera tidak dapat diakses|Akses kamera ditolak/)).not.toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });
});
