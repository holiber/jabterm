import { defineConfig } from "@playwright/test";

const PORT = parseInt(process.env.JABTERM_PORT || "3223", 10);
const DEMO_PORT = PORT + 1;

const E2E = /.*\.e2e\.(ts|js)x?$/;
const SCENARIO = /.*\.scenario\.e2e\.(ts|js)x?$/;
const DOCS = /.*\.docs\.e2e\.(ts|js)x?$/;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${DEMO_PORT}`,
  },
  projects: [
    { name: "e2e", testMatch: E2E, testIgnore: [SCENARIO, DOCS] },
    { name: "scenario", testMatch: SCENARIO, testIgnore: [DOCS] },
    { name: "docs", testMatch: DOCS },
  ],
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
      port: DEMO_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        DEMO_PORT: String(DEMO_PORT),
        JABTERM_WS_PORT: String(PORT),
        ...(process.env.NODE_V8_COVERAGE
          ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
          : {}),
      },
    },
  ],
});
