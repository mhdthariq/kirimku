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
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/domain/**/*.ts", "src/application/**/*.ts", "src/infrastructure/**/*.ts", "src/composition/**/*.ts", "src/presentation/**/*.ts", "src/shared/**/*.ts", "src/hooks/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/app/api/**/route.ts"],
      exclude: ["src/infrastructure/persistence/db.ts", "src/infrastructure/auth/auth.ts", "**/*.test.{ts,tsx}"],
    },
  },
});
