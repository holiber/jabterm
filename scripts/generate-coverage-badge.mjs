import fs from "node:fs/promises";
import path from "node:path";

function coverageColor(pct) {
  if (pct >= 95) return "brightgreen";
  if (pct >= 90) return "green";
  if (pct >= 80) return "yellowgreen";
  if (pct >= 70) return "yellow";
  if (pct >= 60) return "orange";
  return "red";
}

function formatPct(pct) {
  if (!Number.isFinite(pct)) return "0%";
  const rounded = Math.round(pct);
  return `${rounded}%`;
}

const summaryPath = process.argv[2] || "coverage/coverage-summary.json";
const outPath = process.argv[3] || "coverage/badge.json";

const raw = await fs.readFile(summaryPath, "utf-8");
const json = JSON.parse(raw);

const pct =
  json?.total?.lines?.pct ??
  json?.total?.statements?.pct ??
  json?.total?.branches?.pct ??
  0;

const message = formatPct(pct);

const badge = {
  schemaVersion: 1,
  label: "server coverage",
  message,
  color: coverageColor(Number(pct)),
};

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(badge) + "\n", "utf-8");
