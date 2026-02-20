import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const OUTPUT_VIDEO = path.resolve("docs/demo.webm");
const OUTPUT_GIF = path.resolve("docs/demo.gif");

function resolveFfmpegPath(): string {
  if (process.platform === "win32") {
    throw new Error("GIF generation is currently supported only on Unix-like OSes.");
  }
  const probe = spawnSync("bash", ["-lc", "command -v ffmpeg"], {
    encoding: "utf8",
  });
  const resolved = (probe.stdout || "").trim();
  if (probe.status === 0 && resolved) return resolved;
  throw new Error(
    "Could not find `ffmpeg` on PATH. Install ffmpeg to generate docs/demo.gif.",
  );
}

function generateGifFromWebm(webmPath: string, gifPath: string): void {
  const ffmpeg = resolveFfmpegPath();
  const tmpPalette = path.join(os.tmpdir(), `jabterm_palette_${Date.now()}.png`);
  const fps = 12;
  const width = 720;
  const scale = `scale=${width}:-1:flags=lanczos`;

  const paletteGen = spawnSync(ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    webmPath,
    "-vf",
    `fps=${fps},${scale},palettegen`,
    tmpPalette,
  ]);
  if (paletteGen.status !== 0) {
    throw new Error(
      `ffmpeg palettegen failed (exit ${paletteGen.status}).\n` +
        `${paletteGen.stderr?.toString() || ""}`,
    );
  }

  const paletteUse = spawnSync(ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    webmPath,
    "-i",
    tmpPalette,
    "-lavfi",
    `fps=${fps},${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    gifPath,
  ]);
  try {
    fs.unlinkSync(tmpPalette);
  } catch {
    // ignore
  }
  if (paletteUse.status !== 0) {
    throw new Error(
      `ffmpeg paletteuse failed (exit ${paletteUse.status}).\n` +
        `${paletteUse.stderr?.toString() || ""}`,
    );
  }
}

test.use({
  video: {
    mode: "on",
    // 720p keeps the README demo compact while staying readable.
    size: { width: 1280, height: 720 },
  },
});

test.describe("Terminal - demo video", () => {
  test("records terminal usage flow", async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1280, height: 720 });
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

    await page.keyboard.type("clear", { delay: 20 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);

    await page.keyboard.type("cat /tmp/jabterm_video_demo.txt", { delay: 18 });
    await page.keyboard.press("Enter");

    const rows = page.locator('[data-testid="jabterm-1"] .xterm-rows');
    await expect(rows).toContainText("JabTerm demo video", { timeout: 10_000 });
    await expect(rows).toContainText("This text is written inside a TUI editor.", {
      timeout: 10_000,
    });
    await page.waitForTimeout(1200);

    const video = page.video();
    expect(video).not.toBeNull();

    fs.mkdirSync(path.dirname(OUTPUT_VIDEO), { recursive: true });
    await page.context().close();
    await video!.saveAs(OUTPUT_VIDEO);
    const size = fs.statSync(OUTPUT_VIDEO).size;
    expect(size).toBeGreaterThan(0);

    generateGifFromWebm(OUTPUT_VIDEO, OUTPUT_GIF);
    const gifSize = fs.statSync(OUTPUT_GIF).size;
    expect(gifSize).toBeGreaterThan(0);
  });
});
