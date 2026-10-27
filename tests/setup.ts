import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Browser APIs used by searchable combobox lists are absent in jsdom.
if (typeof window !== "undefined") {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
}

// Node route tests have no DOM; UI tests must not leak mounted trees.
afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
