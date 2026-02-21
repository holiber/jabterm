/**
 * React demo smoke test.
 *
 * Ensures the demo page exercises `jabterm/react` (mount/unmount, layout resize,
 * and unexpected close UI) rather than a plain xterm CDN implementation.
 */

import { test, expect } from "@playwright/test";
import { breath } from "./helpers/human.js";

test.describe("@scenario React demo page", () => {
  test("mount/unmount and layout resize work", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const resp = await page.goto("/");
    expect(resp?.ok()).toBe(true);

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });

    const state1 = page.locator('[data-testid="jabterm-1"] [data-jabterm-state]');
    await expect(state1).toHaveAttribute("data-jabterm-state", "open", {
      timeout: 15_000,
    });

    const container = page.locator('[data-testid="jabterm-1"]');
    const before = await container.boundingBox();
    expect(before).not.toBeNull();

    // Imperative handle smoke: focus + fit should not throw.
    await page.evaluate(() => {
      // @ts-ignore
      const ref = window.__jabterm?.term1;
      if (!ref?.current) throw new Error("Missing term1 ref");
      ref.current.focus();
      ref.current.fit();
    });

    const SENTINEL = `__JABTERM_READNEW_${Date.now()}__`;
    await page.evaluate((s) => {
      // @ts-ignore
      const ref = window.__jabterm?.term1;
      if (!ref?.current) throw new Error("Missing term1 ref");
      ref.current.send(`echo ${s}\n`);
    }, SENTINEL);
    await page.waitForFunction(() => {
      // @ts-ignore
      const ref = window.__jabterm?.term1;
      return !!ref?.current && ref.current.getNewCount() > 0;
    });
    const newOut = await page.evaluate(() => {
      // @ts-ignore
      const ref = window.__jabterm?.term1;
      return ref.current.readNew();
    });
    expect(newOut).toContain(SENTINEL);

    await page.waitForFunction(() => !!window.__jabtermDemo?.toggleTerm1);
    await page.evaluate(() => window.__jabtermDemo.toggleTerm1());
    await expect(page.getByTestId("unmounted-1")).toBeVisible();

    await page.evaluate(() => window.__jabtermDemo.toggleTerm1());
    await expect(term1).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => window.__jabtermDemo.toggleLayout());
    const after = await container.boundingBox();
    expect(after).not.toBeNull();

    expect(Math.abs(after!.width - before!.width)).toBeGreaterThan(20);

    expect(consoleErrors).toEqual([]);
  });

  test("shows close message when shell exits", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const resp = await page.goto("/");
    expect(resp?.ok()).toBe(true);

    const term1 = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term1).toBeVisible({ timeout: 15_000 });

    await term1.click();
    await breath(500);
    await page.keyboard.type("exit", { delay: 10 });
    await page.keyboard.press("Enter");

    const rows = page.locator('[data-testid="jabterm-1"] .xterm-rows');
    await expect(rows).toContainText("Connection closed", { timeout: 15_000 });

    const state1 = page.locator('[data-testid="jabterm-1"] [data-jabterm-state]');
    await expect(state1).toHaveAttribute("data-jabterm-state", "closed", {
      timeout: 15_000,
    });

    expect(consoleErrors).toEqual([]);
  });
});

