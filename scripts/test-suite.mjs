import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();

function getPackageManager() {
  try {
    const pkgPath = path.join(ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const pm = String(pkg?.packageManager || "");
    if (pm.startsWith("pnpm@")) return "pnpm";
    if (pm.startsWith("npm@")) return "npm";
  } catch {
    /* ignore */
  }

  if (fs.existsSync(path.join(ROOT, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(ROOT, "package-lock.json"))) return "npm";
  return "npm";
}

const PM = getPackageManager();

function artifactsDirFor(suite) {
  switch (suite) {
    case "unit":
      return path.join(ROOT, ".cache/tests/test-unit__vitest");
    case "scenario":
      return path.join(ROOT, ".cache/tests/test-scenario__playwright");
    case "e2e":
      return path.join(ROOT, ".cache/tests/test-e2e__playwright");
    case "integration":
      return path.join(ROOT, ".cache/tests/test-integration__none");
    case "smoke":
      return path.join(ROOT, ".cache/tests/test-smoke__scenario");
    case "all":
      return path.join(ROOT, ".cache/tests/test__all");
    default:
      throw new Error(`Unknown suite: ${suite}`);
  }
}

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

function spawnLogged(cmd, args, { env, cwd, logStream, passthrough }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onOut = (chunk) => {
      logStream.write(chunk);
      if (passthrough) process.stdout.write(chunk);
    };
    const onErr = (chunk) => {
      logStream.write(chunk);
      if (passthrough) process.stderr.write(chunk);
    };

    child.stdout.on("data", onOut);
    child.stderr.on("data", onErr);

    child.on("close", (code, signal) => resolve({ code, signal, child }));
  });
}

function spawnLoggedWithTimeout(cmd, args, { env, cwd, logStream, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => logStream.write(chunk));
    child.stderr.on("data", (chunk) => logStream.write(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 1500).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut });
    });
  });
}

function envWithArtifacts(artifactsDir, extraEnv = {}) {
  return {
    ...process.env,
    ...extraEnv,
    TEST_ARTIFACTS_DIR: artifactsDir,
  };
}

async function runUnit({ artifactsDir, logStream }) {
  const env = envWithArtifacts(artifactsDir);
  return await spawnLogged(PM, ["exec", "vitest", "run"], {
    cwd: ROOT,
    env,
    logStream,
    passthrough: true,
  });
}

async function runPlaywright({
  artifactsDir,
  logStream,
  grep,
  grepInvert = [],
  smoke,
  human,
}) {
  const skipBuild = process.env.JABTERM_SKIP_BUILD === "1";

  const env = envWithArtifacts(
    artifactsDir,
    {
      ...(smoke ? { JABTERM_SMOKE: "1" } : {}),
      ...(human ? { JABTERM_HUMAN: "1" } : {}),
    },
  );

  if (!skipBuild) {
    const build = await spawnLogged(PM, ["run", "build"], {
      cwd: ROOT,
      env,
      logStream,
      passthrough: true,
    });
    if (build.code !== 0) return { code: build.code, signal: build.signal };
  }

  const args = ["exec", "playwright", "test", "--grep", grep];
  for (const inv of grepInvert) args.push("--grep-invert", inv);
  args.push("--project", human ? "human" : "default");
  if (smoke) args.push("--max-failures=1", "--quiet");

  return await spawnLogged(PM, args, {
    cwd: ROOT,
    env,
    logStream,
    passthrough: !smoke,
  });
}

function truncateOneLine(s, max = 160) {
  const one = String(s || "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function collectTestsFromSuites(suites, out) {
  for (const s of suites || []) {
    if (s.tests) {
      for (const t of s.tests) out.push(t);
    }
    if (s.suites) collectTestsFromSuites(s.suites, out);
  }
}

function getFinalStatus(test) {
  const results = test?.results || [];
  for (const r of results) {
    if (r.status === "failed" || r.status === "timedOut") return "failed";
  }
  for (const r of results) {
    if (r.status === "passed") return "passed";
  }
  for (const r of results) {
    if (r.status === "skipped") return "skipped";
  }
  return "unknown";
}

function scenarioFiltersFromEnv() {
  const onlyDocs = process.env.JABTERM_SCENARIO_ONLY_DOCS === "1";
  const includeDocs = process.env.JABTERM_SCENARIO_INCLUDE_DOCS === "1";
  const includeSlow = process.env.JABTERM_SCENARIO_INCLUDE_SLOW === "1";

  if (onlyDocs) {
    return { grep: "@docs", grepInvert: [] };
  }

  const grepInvert = [];
  if (!includeDocs) grepInvert.push("@docs");
  if (!includeSlow) grepInvert.push("@slow");
  return { grep: "@scenario", grepInvert };
}

async function runSmoke({ artifactsDir, logStream }) {
  const startedAt = Date.now();
  const perTestTimeoutMs = parseInt(
    process.env.SMOKE_PER_TEST_TIMEOUT_MS || "30000",
    10,
  );
  const totalTimeoutMs = parseInt(
    process.env.SMOKE_TOTAL_TIMEOUT_MS || "180000",
    10,
  );
  const warnAfterMs = parseInt(process.env.SMOKE_WARN_AFTER_MS || "60000", 10);

  const jsonReport = path.join(artifactsDir, "playwright-report.json");
  const env = envWithArtifacts(artifactsDir, {
    JABTERM_SMOKE: "1",
    SMOKE_PER_TEST_TIMEOUT_MS: String(perTestTimeoutMs),
    SMOKE_TOTAL_TIMEOUT_MS: String(totalTimeoutMs),
    PW_JSON_OUTPUT_FILE: jsonReport,
  });

  const skipBuild = process.env.JABTERM_SKIP_BUILD === "1";
  if (!skipBuild) {
    const build = await spawnLogged(PM, ["run", "build"], {
      cwd: ROOT,
      env,
      logStream,
      passthrough: false,
    });
    if (build.code !== 0) {
      console.log(
        `SMOKE FAIL: build (exit ${build.code ?? "?"}) | Artifacts: ${artifactsDir}`,
      );
      process.exit(build.code || 1);
    }
  }

  const warn = setTimeout(() => {
    /* marker only; we keep success output to one line */
  }, warnAfterMs);
  warn.unref?.();

  const smokeArgs = [
    "exec",
    "playwright",
    "test",
    "--grep",
    "@scenario",
    "--grep-invert",
    "@docs",
    "--grep-invert",
    "@slow",
    "--project",
    process.env.JABTERM_HUMAN === "1" ? "human" : "default",
    "--max-failures=1",
    "--quiet",
  ];

  const pw = await spawnLoggedWithTimeout(PM, smokeArgs, {
    cwd: ROOT,
    env,
    logStream,
    timeoutMs: totalTimeoutMs,
  });
  clearTimeout(warn);

  const elapsedS = (Date.now() - startedAt) / 1000;
  const slow = elapsedS * 1000 > warnAfterMs;

  if (pw.timedOut) {
    console.log(
      `SMOKE FAIL: scenario (timeout after ${Math.round(elapsedS)}s) | Artifacts: ${artifactsDir}`,
    );
    process.exit(1);
  }

  if (pw.code === 0) {
    let passed = 0;
    let total = 0;
    try {
      const raw = await fsp.readFile(jsonReport, "utf8");
      const report = JSON.parse(raw);
      const tests = [];
      collectTestsFromSuites(report?.suites, tests);
      total = tests.length;
      for (const t of tests) {
        if (getFinalStatus(t) === "passed") passed++;
      }
    } catch {
      // best-effort; keep smoke output stable even if JSON isn't available
    }

    const ratio = total > 0 ? `${passed}/${total}` : "all";
    const warnSuffix = slow ? " (warn: exceeded SMOKE_WARN_AFTER_MS)" : "";
    console.log(`SMOKE: ${ratio} passed in ${elapsedS.toFixed(1)}s${warnSuffix}`);
    process.exit(0);
  }

  // Failure
  let failName = "scenario";
  let reason = `exit ${pw.code ?? "?"}`;
  try {
    const raw = await fsp.readFile(jsonReport, "utf8");
    const report = JSON.parse(raw);
    const tests = [];
    collectTestsFromSuites(report?.suites, tests);
    const firstFail = tests.find((t) => getFinalStatus(t) === "failed");
    if (firstFail) {
      failName = firstFail.title ? String(firstFail.title) : failName;
      const lastResult = (firstFail.results || []).at(-1);
      const err = lastResult?.error?.message || lastResult?.error?.value;
      if (err) reason = truncateOneLine(err);
    }
  } catch {
    /* ignore */
  }

  console.log(
    `SMOKE FAIL: ${truncateOneLine(failName, 80)} (${reason}) | Artifacts: ${artifactsDir}`,
  );
  process.exit(pw.code || 1);
}

async function main() {
  const args = process.argv.slice(2);
  const suite = args[0];
  if (!suite) {
    throw new Error(
      "Usage: node scripts/test-suite.mjs <unit|scenario|e2e|integration|smoke|all> [--human]",
    );
  }

  const human = args.includes("--human");

  const artifactsDir = artifactsDirFor(suite);
  await rmrf(artifactsDir);
  await mkdirp(artifactsDir);

  const logPath = path.join(artifactsDir, "run.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  try {
    if (suite === "smoke") {
      if (human) process.env.JABTERM_HUMAN = "1";
      await runSmoke({ artifactsDir, logStream });
      return;
    }

    if (suite === "unit") {
      const res = await runUnit({ artifactsDir, logStream });
      process.exit(res.code || 0);
    }

    if (suite === "scenario") {
      const { grep, grepInvert } = scenarioFiltersFromEnv();
      const res = await runPlaywright({
        artifactsDir,
        logStream,
        grep,
        grepInvert,
        smoke: false,
        human,
      });
      process.exit(res.code || 0);
    }

    if (suite === "e2e") {
      const res = await runPlaywright({
        artifactsDir,
        logStream,
        grep: "@e2e",
        smoke: false,
        human,
      });
      process.exit(res.code || 0);
    }

    if (suite === "integration") {
      logStream.write(
        Buffer.from(
          "This repo intentionally has no integration tests. (contract script exists)\n",
        ),
      );
      process.stdout.write(
        "No integration tests in this repo. (intentional)\n",
      );
      process.exit(0);
    }

    if (suite === "all") {
      // Unit first for fast feedback.
      const unit = await spawnLogged(PM, ["exec", "vitest", "run"], {
        cwd: ROOT,
        env: envWithArtifacts(path.join(artifactsDir, "unit")),
        logStream,
        passthrough: true,
      });
      if (unit.code !== 0) process.exit(unit.code || 1);

      const skipBuild = process.env.JABTERM_SKIP_BUILD === "1";
      if (!skipBuild) {
        const build = await spawnLogged(PM, ["run", "build"], {
          cwd: ROOT,
          env: envWithArtifacts(artifactsDir),
          logStream,
          passthrough: true,
        });
        if (build.code !== 0) process.exit(build.code || 1);
      }

      const pwEnvBase = {
        ...process.env,
        JABTERM_SKIP_BUILD: "1",
      };

      const scenarioDir = path.join(artifactsDir, "scenario");
      await rmrf(scenarioDir);
      await mkdirp(scenarioDir);
      const scenario = await spawnLogged(
        PM,
        [
          "exec",
          "playwright",
          "test",
          "--grep",
          "@scenario",
          "--grep-invert",
          "@docs",
          "--grep-invert",
          "@slow",
          "--project",
          "default",
        ],
        {
          cwd: ROOT,
          env: envWithArtifacts(scenarioDir, pwEnvBase),
          logStream,
          passthrough: true,
        },
      );
      if (scenario.code !== 0) process.exit(scenario.code || 1);

      const e2eDir = path.join(artifactsDir, "e2e");
      await rmrf(e2eDir);
      await mkdirp(e2eDir);
      const e2e = await spawnLogged(PM, ["exec", "playwright", "test", "--grep", "@e2e", "--project", "default"], {
        cwd: ROOT,
        env: envWithArtifacts(e2eDir, pwEnvBase),
        logStream,
        passthrough: true,
      });
      if (e2e.code !== 0) process.exit(e2e.code || 1);

      process.exit(0);
    }

    process.exit(1);
  } finally {
    await new Promise((resolve) => logStream.end(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
