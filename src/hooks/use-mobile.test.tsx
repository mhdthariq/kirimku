// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("reads the initial media query and subscribes with cleanup", () => {
  let matches = true;
  const listeners = new Set<() => void>();
  const addEventListener = vi.fn((_event: string, callback: () => void) => listeners.add(callback));
  const removeEventListener = vi.fn((_event: string, callback: () => void) => listeners.delete(callback));
  const matchMedia = vi.fn(() => ({
    get matches() { return matches; },
    addEventListener,
    removeEventListener,
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  const { result, unmount } = renderHook(useIsMobile);
  expect(result.current).toBe(true);
  expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
  act(() => { matches = false; listeners.forEach((listener) => listener()); });
  expect(result.current).toBe(false);
  unmount();
  expect(listeners.size).toBe(0);
  expect(removeEventListener).toHaveBeenCalledWith("change", addEventListener.mock.calls[0][1]);
});
