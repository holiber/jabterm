import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = parseInt(process.env.JABTERM_PORT || "3223", 10);
const ARTIFACTS_DIR = process.env.TEST_ARTIFACTS_DIR;
const IS_SMOKE = process.env.JABTERM_SMOKE === "1";

const outputDir = ARTIFACTS_DIR
  ? path.join(ARTIFACTS_DIR, "test-results")
  : ".cache/test-results";
const reportDir = ARTIFACTS_DIR
  ? path.join(ARTIFACTS_DIR, "report")
  : ".cache/report";

const smokePerTestTimeoutMs = parseInt(
  process.env.SMOKE_PER_TEST_TIMEOUT_MS || "30000",
  10,
);
const smokeTotalTimeoutMs = parseInt(
  process.env.SMOKE_TOTAL_TIMEOUT_MS || "180000",
  10,
);

export default defineConfig({
  testDir: "./tests",
  // Keep Playwright focused on E2E specs. Vitest unit tests live under `tests/unit/**`
  // and use the `.test.*` suffix, which Playwright would otherwise pick up by default.
  testMatch: ["**/*.spec.ts", "**/*.spec.tsx"],
  outputDir,
  ...(IS_SMOKE ? { timeout: smokePerTestTimeoutMs } : {}),
  ...(IS_SMOKE ? { globalTimeout: smokeTotalTimeoutMs } : {}),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: IS_SMOKE
    ? [
        [
          "json",
          {
            outputFile:
              process.env.PW_JSON_OUTPUT_FILE ||
              (ARTIFACTS_DIR
                ? path.join(ARTIFACTS_DIR, "playwright-report.json")
                : ".cache/playwright-report.json"),
          },
        ],
      ]
    : [["html", { outputFolder: reportDir, open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT + 1}`,
  },
  webServer: [
    {
      command: `node bin/jabterm-server.mjs --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        JABTERM_STRICT_PORT: "1",
        ...(process.env.NODE_V8_COVERAGE
          ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
          : {}),
      },
    },
    {
      command: `node tests/serve-demo.mjs`,
      port: PORT + 1,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        DEMO_PORT: String(PORT + 1),
        JABTERM_WS_PORT: String(PORT),
        ...(process.env.NODE_V8_COVERAGE
          ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
          : {}),
      },
    },
  ],
});
