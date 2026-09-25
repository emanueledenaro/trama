import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@": resolve(import.meta.dirname, "src/renderer"),
    },
  },
  // Git-heavy tests pass 5 s on a loaded macOS runner; the limit guards hangs, not speed.
  test: { include: ["src/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
