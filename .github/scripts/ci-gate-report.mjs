#!/usr/bin/env node
// The CI gate's verdict table (ci.yml `ci-gate`): names every needed suite
// and its result so a red run names the failing job instead of printing a
// bare status list. Exit codes: 0 = all suites passed or skipped on purpose,
// 1 = at least one failure or cancellation (named via ::error::).
const labels = {
  "detect-changes": "Path gating (detect-changes)",
  "lint-and-typecheck": "Lint + typecheck",
  "workflows-lint": "Workflow lint",
  "framework-unit": "Framework unit tests",
  "framework-integration": "Framework integration tests",
  "better-near-auth": "better-near-auth tests",
  "plugin-tests": "Plugin tests",
  "ui-api-tests": "UI/API tests",
  "host-tests": "Host tests",
  "regression-unit": "Regression: unit",
  "regression-http": "Regression: HTTP",
  "regression-http-start": "Regression: HTTP (start stack)",
  "regression-framework": "Regression: framework",
  "regression-browser": "Regression: browser",
  "regression-browser-smoke": "Regression: browser smoke",
  "regression-browser-start": "Regression: browser (start stack)",
};

const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
const rows = Object.entries(needs).map(([id, info]) => [
  labels[id] ?? id,
  info?.result ?? "unknown",
]);

console.log("### CI suite results");
console.log("");
console.log("| Suite | Result |");
console.log("|-------|--------|");
for (const [label, result] of rows) {
  console.log(
    `| ${label} | ${result === "success" ? "✓ success" : result === "skipped" ? "– skipped" : `✗ ${result}`} |`,
  );
}

const failed = rows.filter(([, result]) => result === "failure" || result === "cancelled");
for (const [label, result] of failed) {
  console.log(`::error::Suite "${label}" ${result} — see that job's log above`);
}
process.exit(failed.length > 0 ? 1 : 0);
