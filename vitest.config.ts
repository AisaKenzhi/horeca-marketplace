import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/domain/**", "src/data/**"],
      // Type-only modules (e.g. entities.ts) have no runtime code to cover.
      exclude: ["src/domain/entities.ts"],
      // Honest floors measured on the current suite, set a little below the
      // observed values so they stop regressions without being aspirational.
      // Raise them deliberately as coverage genuinely improves.
      thresholds: {
        statements: 82,
        branches: 74,
        functions: 85,
        lines: 82,
      },
    },
  },
});
