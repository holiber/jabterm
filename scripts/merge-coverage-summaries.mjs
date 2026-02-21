import fs from "node:fs/promises";
import path from "node:path";

function readJsonSafe(obj) {
  if (!obj || typeof obj !== "object") return {};
  return obj;
}

function asMetric(maybe) {
  const m = maybe && typeof maybe === "object" ? maybe : {};
  const total = Number(m.total) || 0;
  const covered = Number(m.covered) || 0;
  const skipped = Number(m.skipped) || 0;
  return { total, covered, skipped };
}

function mergeMetric(a, b) {
  const total = a.total + b.total;
  const covered = a.covered + b.covered;
  const skipped = a.skipped + b.skipped;
  const pct = total > 0 ? (covered / total) * 100 : 100;
  return { total, covered, skipped, pct };
}

function mergeTotals(totalA, totalB) {
  const out = {};
  const keys = new Set([
    ...Object.keys(totalA || {}),
    ...Object.keys(totalB || {}),
  ]);
  for (const k of keys) {
    out[k] = mergeMetric(asMetric(totalA?.[k]), asMetric(totalB?.[k]));
  }
  return out;
}

const serverPath = process.argv[2];
const clientPath = process.argv[3];
const outPath = process.argv[4] || "coverage/coverage-summary.json";

if (!serverPath || !clientPath) {
  throw new Error(
    "Usage: node scripts/merge-coverage-summaries.mjs <server-summary.json> <client-summary.json> [out.json]",
  );
}

const [serverRaw, clientRaw] = await Promise.all([
  fs.readFile(serverPath, "utf-8"),
  fs.readFile(clientPath, "utf-8"),
]);

const serverJson = readJsonSafe(JSON.parse(serverRaw));
const clientJson = readJsonSafe(JSON.parse(clientRaw));

const merged = {};
merged.total = mergeTotals(serverJson.total ?? {}, clientJson.total ?? {});

const serverFiles = Object.entries(serverJson).filter(([k]) => k !== "total");
const clientFiles = Object.entries(clientJson).filter(([k]) => k !== "total");

for (const [k, v] of serverFiles) merged[k] = v;
for (const [k, v] of clientFiles) {
  if (merged[k] == null) merged[k] = v;
}

const keys = Object.keys(merged).filter((k) => k !== "total").sort();
const out = { total: merged.total };
for (const k of keys) out[k] = merged[k];

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");

