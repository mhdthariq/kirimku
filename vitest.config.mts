import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// API/library tests run in Node; UI suites opt into jsdom per file.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts", "src/hooks/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/app/api/**/route.ts"],
      exclude: ["src/lib/db.ts", "src/lib/auth.ts", "**/*.test.{ts,tsx}"],
    },
  },
});
