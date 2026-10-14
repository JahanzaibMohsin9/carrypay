import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    env: { CARRYPAY_STEP_DELAY_MS: "0", CARRYPAY_DATA_DIR: path.resolve(import.meta.dirname, ".data-test") },
  },
});
