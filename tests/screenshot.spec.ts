/**
 * Screenshot Test — captures terminal screenshots for README.
 *
 * Opens demo-page.html with two JabTerm instances:
 *   1. Runs `echo "Hello from JabTerm"` -> captures terminal-echo.png
 *   2. Opens nano with a syntax-highlighted file -> captures terminal-tui.png
 */

import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREENSHOTS_DIR = path.resolve("docs/screenshots");

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
});

test.describe("Terminal — README screenshots", () => {
  test("capture echo terminal screenshot", async ({ page }) => {
    await page.goto("/");

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });

    // Wait for shell prompt to appear
    await page.waitForTimeout(2000);

    // Type the echo command in the first terminal
    await term1.click();
    await page.keyboard.type('echo "Hello from JabTerm"', { delay: 30 });
    await page.keyboard.press("Enter");

    // Wait for output to render
    await page.waitForTimeout(1500);

    // Capture screenshot of just the first terminal pane
    const pane1 = page.locator('[data-testid="jabterm-1"]');
    await pane1.screenshot({
      path: path.join(SCREENSHOTS_DIR, "terminal-echo.png"),
    });
  });

  test("capture nano TUI screenshot", async ({ page }) => {
    await page.goto("/");

    const term2 = page.locator('[data-testid="jabterm-2"] .xterm-screen');
    await expect(term2).toBeVisible({ timeout: 15_000 });

    // Wait for shell prompt
    await page.waitForTimeout(2000);

    // Create a sample file with some content, then open nano
    await term2.click();
    await page.keyboard.type(
      'printf "#!/bin/bash\\n\\n# JabTerm Demo Script\\necho \\"Hello World\\"\\n\\nfor i in 1 2 3; do\\n  echo \\"Count: $i\\"\\ndone\\n" > /tmp/jabterm_demo.sh && nano --syntax=sh /tmp/jabterm_demo.sh',
      { delay: 10 },
    );
    await page.keyboard.press("Enter");

    // Wait for nano to fully render
    await page.waitForTimeout(3000);

    const pane2 = page.locator('[data-testid="jabterm-2"]');
    await pane2.screenshot({
      path: path.join(SCREENSHOTS_DIR, "terminal-tui.png"),
    });

    // Exit nano cleanly
    await page.keyboard.press("Control+X");
    await page.waitForTimeout(500);
  });

  test("capture full demo page with both terminals", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    const term2 = page.locator('[data-testid="jabterm-2"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });
    await expect(term2).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(2000);

    // Type in terminal 1
    await term1.click();
    await page.keyboard.type('echo "Terminal 1 — Hello from JabTerm"', { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    // Type in terminal 2
    await term2.click();
    await page.keyboard.type('echo "Terminal 2 — Independent session"', { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "demo-dual-terminals.png"),
      fullPage: false,
    });
  });
});
