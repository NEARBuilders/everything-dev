#!/usr/bin/env node
// Human summary for `pnpm audit --json` output (ci.yml, consumer-ci.yml).
// Exit codes: 0 = clean, 3 = output unreadable, 10 = critical/high found.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "audit-output.json";
let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.log(
    `::warning::pnpm audit output is not valid JSON — vulnerability summary unavailable (${error instanceof Error ? error.message : String(error)})`,
  );
  process.exit(3);
}

const meta = report.metadata?.vulnerabilities ?? {};
const count = (severity) => meta[severity] ?? 0;
console.log(
  `pnpm audit: ${count("critical")} critical · ${count("high")} high · ${count("moderate")} moderate · ${count("low")} low`,
);

const advisories = Object.values(report.advisories ?? {});
const severe = advisories.filter((a) => a.severity === "critical" || a.severity === "high");
if (severe.length === 0) process.exit(0);

console.log("Critical and high advisories:");
for (const advisory of severe) {
  console.log(
    `  - ${advisory.module_name}: ${advisory.title} (${advisory.severity}) — patched in ${advisory.patched_versions || "no patch"}`,
  );
}
process.exit(10);
