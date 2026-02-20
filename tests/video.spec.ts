import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const OUTPUT_VIDEO = path.resolve("docs/demo.webm");

function isMcInstalled(): boolean {
  if (process.platform === "win32") return false;
  const result = spawnSync("bash", ["-lc", "command -v mc >/dev/null 2>&1"]);
  return result.status === 0;
}

test.use({ video: "on" });

test.describe("Terminal - demo video", () => {
  test("records terminal usage flow", async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");

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
        "vim -u NONE -i NONE -n /tmp/jabterm_video_demo.txt; " +
        "else vi /tmp/jabterm_video_demo.txt; fi",
      { delay: 16 },
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1400);

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

    if (isMcInstalled()) {
      await page.keyboard.type("mc", { delay: 25 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2200);

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1200);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(300);
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(300);
      await page.keyboard.press("F10");
      await page.waitForTimeout(1000);
    } else {
      await page.keyboard.type("echo 'mc is not installed on this machine'", { delay: 25 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
    }

    const video = page.video();
    expect(video).not.toBeNull();

    fs.mkdirSync(path.dirname(OUTPUT_VIDEO), { recursive: true });
    await page.context().close();
    await video!.saveAs(OUTPUT_VIDEO);
    const size = fs.statSync(OUTPUT_VIDEO).size;
    expect(size).toBeGreaterThan(0);
  });
});
