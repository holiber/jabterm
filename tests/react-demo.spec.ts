/**
 * React demo smoke test.
 *
 * Ensures the demo page exercises `jabterm/react` (mount/unmount, layout resize,
 * and unexpected close UI) rather than a plain xterm CDN implementation.
 */

import { test, expect } from "@playwright/test";

test.describe("React demo page", () => {
  test("mount/unmount and layout resize work", async ({ page }) => {
    await page.goto("/");

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });

    const container = page.locator('[data-testid="jabterm-1"]');
    const before = await container.boundingBox();
    expect(before).not.toBeNull();

    await page.waitForFunction(() => !!window.__jabtermDemo?.toggleTerm1);
    await page.evaluate(() => window.__jabtermDemo.toggleTerm1());
    await expect(page.getByTestId("unmounted-1")).toBeVisible();

    await page.evaluate(() => window.__jabtermDemo.toggleTerm1());
    await expect(term1).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => window.__jabtermDemo.toggleLayout());
    const after = await container.boundingBox();
    expect(after).not.toBeNull();

    expect(Math.abs(after!.width - before!.width)).toBeGreaterThan(20);
  });

  test("shows close message when shell exits", async ({ page }) => {
    await page.goto("/");

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });

    await term1.click();
    await page.waitForTimeout(500);
    await page.keyboard.type("exit", { delay: 10 });
    await page.keyboard.press("Enter");

    const rows = page.locator('[data-testid="jabterm-1"] .xterm-rows');
    await expect(rows).toContainText("Connection closed", { timeout: 15_000 });
  });
});

