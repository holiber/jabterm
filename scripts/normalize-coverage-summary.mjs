import fs from "node:fs/promises";
import path from "node:path";

const summaryPath = process.argv[2] || "coverage/coverage-summary.json";

const raw = await fs.readFile(summaryPath, "utf-8");
const json = JSON.parse(raw);

const out = { total: json.total ?? {} };

const entries = Object.entries(json).filter(([k]) => k !== "total");
entries.sort(([a], [b]) => a.localeCompare(b));

for (const [filePath, metrics] of entries) {
  const rel = path.relative(process.cwd(), filePath);
  const key = rel.startsWith("..") ? filePath : `./${rel}`;
  out[key] = metrics;
}

await fs.writeFile(summaryPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
