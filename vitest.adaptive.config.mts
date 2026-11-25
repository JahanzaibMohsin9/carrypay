import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// The adaptive red team (the live model as attacker and as target); used only by `npm run redteam:adaptive`.
// API keys from .env.local, as in vitest.redteam.config.mts.
const envFile = path.resolve(import.meta.dirname, ".env.local");
const keys: Record<string, string> = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) keys[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.adaptive.ts"],
    testTimeout: 3 * 60 * 60 * 1000,
    env: { ...keys, CARRYPAY_STEP_DELAY_MS: "0", CARRYPAY_DATA_DIR: path.resolve(import.meta.dirname, ".data-redteam"), CARRYPAY_LLM_TIMEOUT_MS: "480000" },
  },
});
