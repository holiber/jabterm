import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const OUTPUT_VIDEO = path.resolve("docs/demo.webm");

test.use({
  video: {
    mode: "on",
    // Larger video frame improves readability and avoids blur.
    size: { width: 1920, height: 1080 },
  },
});

test.describe("Terminal - demo video", () => {
  test("records terminal usage flow", async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    // Video should show just one terminal (Terminal 1).
    await page.evaluate(() => {
      const t2 = document.querySelector('[data-testid="jabterm-2"]');
      const pane = t2?.closest(".term-pane");
      pane?.remove();
    });

    const term = page.locator('[data-testid="jabterm-1"] .xterm-screen');
    await expect(term).toBeVisible({ timeout: 15_000 });

    await term.click();
    await page.waitForTimeout(1800);

    await page.keyboard.type("echo hello", { delay: 28 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    await page.keyboard.type("ls", { delay: 26 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    await page.keyboard.type(
      "rm -f /tmp/jabterm_video_demo.txt && " +
        "if command -v vim >/dev/null 2>&1; then " +
        "vim -u NONE -U NONE -i NONE -n +startinsert /tmp/jabterm_video_demo.txt; " +
        "else vi /tmp/jabterm_video_demo.txt; fi",
      { delay: 16 },
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    await page.keyboard.type("JabTerm demo video", { delay: 14 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.keyboard.type("This text is written inside a TUI editor.", {
      delay: 14,
    });
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.keyboard.type(":wq", { delay: 24 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    await page.keyboard.type("cat /tmp/jabterm_video_demo.txt", { delay: 18 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1400);

    const video = page.video();
    expect(video).not.toBeNull();

    fs.mkdirSync(path.dirname(OUTPUT_VIDEO), { recursive: true });
    await page.context().close();
    await video!.saveAs(OUTPUT_VIDEO);
    const size = fs.statSync(OUTPUT_VIDEO).size;
    expect(size).toBeGreaterThan(0);
  });
});
