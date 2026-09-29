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
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    // Tests wait for the whole candidate gate in the turn, as before ADR 0023; the test of the background gate shortens it.
    // The provider CLIs installed on the machine are never started by the tests, as on CI where there are none.
    env: { TRAMA_GATE_TURN_WAIT_MS: "600000", TRAMA_PROVIDER_DISCOVERY: "off" },
  },
});
