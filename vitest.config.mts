import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config (added 2026-09-27, Phase 1 of docs/CLEAN_ARCHITECTURE_PLAN.md).
 *
 * Scope on purpose: this first pass covers `src/lib/**` — pure,
 * framework-free logic (pricing, coordinate parsing, customer display,
 * generic API helpers). These are the highest-value, lowest-risk tests to
 * add first: no React, no Next.js request/response mocking, no database.
 *
 * API-route tests and component tests are Phase 2/3 in the plan and need
 * more scaffolding (a test database, request/response mocks, RTL) — adding
 * them here would have made this first PR much larger without adding
 * proportional confidence.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/db.ts", "src/lib/auth.ts", "**/*.test.ts"],
    },
  },
});
