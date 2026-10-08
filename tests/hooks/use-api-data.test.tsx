// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApiData } from "../../src/hooks/use-api-data";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useApiData", () => {
  it("ignores inline fetcher identity but reloads when dependencies change", async () => {
    const fetch = vi.fn(async (id: number) => id);
    const { result, rerender } = renderHook(({ id }) => useApiData(() => fetch(id), [id]), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ id: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender({ id: 2 });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(2));
    await act(async () => { await result.current.reload(); });
    expect(fetch).toHaveBeenCalledTimes(3);
    act(() => result.current.setData((value) => (value ?? 0) + 1));
    expect(result.current.data).toBe(3);
  });

  it("does not let an obsolete dependency request replace newer data", async () => {
    const old = deferred<number>();
    const latest = deferred<number>();
    const { result, rerender } = renderHook(({ id }) => useApiData(
      () => id === 1 ? old.promise : latest.promise, [id],
    ), { initialProps: { id: 1 } });
    rerender({ id: 2 });
    await act(async () => latest.resolve(2));
    await act(async () => old.resolve(1));
    expect(result.current.data).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it("exposes errors and clears them during an awaited manual reload", async () => {
    const next = deferred<number>();
    const fetch = vi.fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("Failed"))
      .mockImplementationOnce(() => next.promise);
    const { result } = renderHook(() => useApiData(fetch));
    await waitFor(() => expect(result.current.error).toBe("Failed"));
    let reload!: Promise<void>;
    act(() => { reload = result.current.reload(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { next.resolve(7); await reload; });
    expect(result.current.data).toBe(7);
    expect(result.current.loading).toBe(false);
  });
});
