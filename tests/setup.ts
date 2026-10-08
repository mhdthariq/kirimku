import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node route tests have no DOM; UI tests must not leak mounted trees.
afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
