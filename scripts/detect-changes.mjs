#!/usr/bin/env node
/**
 * Detect changed paths for CI — the single source of truth for which paths
 * gate which suites. The `Detect changed paths` step in ci.yml invokes this
 * script and appends its stdout to $GITHUB_OUTPUT; the logic is pure and
 * unit-tested (packages/everything-dev/tests/unit/detect-changes.test.ts)
 * so the path groups can never drift from each other again.
 *
 * Pattern language (deliberately tiny — no glob engine, no regex): an entry
 * is either an exact path ("package.json" — root-anchored, full path match)
 * or a directory prefix ("ui/**" — everything under it). Groups compose
 * shared sets (ROOT_FILES, CI_WIRING) so sibling arms cannot fork.
 *
 * Touching .github/workflows/ci.yml lights every suite arm on purpose: you
 * changed the CI wiring, so the full matrix validates it (CI_WIRING below).
 */

import { execSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "bos.app.ts",
  "bos.dev.ts",
];

const CI_WIRING = [".github/workflows/ci.yml"];

export const PATH_GROUPS = {
  "everything-dev": [
    "packages/everything-dev/**",
    "packages/every-plugin/**",
    "packages/better-near-auth/**",
    "api/**",
    "plugins/**",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  "every-plugin": ["packages/every-plugin/**", ...ROOT_FILES, ...CI_WIRING],
  plugins: [
    "plugins/**",
    "packages/every-plugin/**",
    "packages/better-near-auth/**",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  "ui-api": [
    "ui/**",
    "api/**",
    "packages/everything-dev/**",
    "packages/every-plugin/**",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  host: ["host/**", "ui/**", "packages/**", ".env.test", ...ROOT_FILES, ...CI_WIRING],
  "regression-http": [
    "tests/regression/http/**",
    "tests/regression/lib/**",
    "host/**",
    "api/**",
    "plugins/**",
    "packages/**",
    "scripts/**",
    "Dockerfile",
    ".env.test",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  "regression-framework": [
    "tests/regression/framework/**",
    "tests/regression/lib/**",
    "packages/everything-dev/src/**",
    "packages/every-plugin/src/**",
    ".env.test",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  "regression-browser": [
    "tests/regression/browser/**",
    "tests/regression/lib/**",
    "host/**",
    "ui/**",
    "api/**",
    "plugins/**",
    "packages/**",
    "scripts/**",
    "Dockerfile",
    ".env.test",
    ...ROOT_FILES,
    ...CI_WIRING,
  ],
  "regression-unit": ["tests/regression/lib/**", ...ROOT_FILES, ...CI_WIRING],
  workflows: [".github/workflows/**", ".github/templates/workflows/**"],
};

const OUTPUT_ORDER = [
  "version",
  "everything-dev",
  "every-plugin",
  "plugins",
  "ui-api",
  "host",
  "regression-http",
  "regression-framework",
  "regression-browser",
  "regression-browser-smoke",
  "regression-unit",
  "workflows",
];

const matches = (file, patterns) => {
  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (file.startsWith(`${prefix}/`)) return true;
    } else if (file === pattern) {
      return true;
    }
  }
  return false;
};

/**
 * Pure core: given the event and the changed-file list, return the CI gate
 * outputs as strings ("true"/"false") — exactly the lines the workflow's
 * `needs.detect-changes.outputs` consumes.
 */
export function detect({ event, prHeadRef = "", files = [] }) {
  const outputs = Object.fromEntries(OUTPUT_ORDER.map((name) => [name, "false"]));

  // Version-PR fast path: the changesets bot's branch is a package-version /
  // changelog-only diff that the release plane's regression gate owns.
  if (event === "pull_request" && prHeadRef.startsWith("changeset-release/")) {
    outputs.version = "true";
    return outputs;
  }

  // Manual dispatch runs everything except the smoke classifier (which is a
  // ui-only optimization with no dispatch semantics) — every output is
  // emitted explicitly so no key can silently go missing again.
  if (event === "workflow_dispatch") {
    for (const name of OUTPUT_ORDER)
      outputs[name] = name === "version" || name === "regression-browser-smoke" ? "false" : "true";
    return outputs;
  }

  for (const name of OUTPUT_ORDER) {
    if (name === "version" || name === "regression-browser-smoke") continue;
    outputs[name] = files.some((file) => matches(file, PATH_GROUPS[name])) ? "true" : "false";
  }

  // ui-only smoke (#826 follow-up): a diff confined to the ui workspace
  // cannot break the host, api, or framework planes — the app-load spec
  // (boot + hydration + runtime-config shape) is the one ui-only risk gate,
  // so the full sharded browser matrix is replaced by it. The browser arm's
  // output reads false when the smoke covers it — the outputs are the
  // decision, the job conditions stay single-source.
  const uiOnly = files.length > 0 && files.every((file) => file.startsWith("ui/"));
  outputs["regression-browser"] = uiOnly ? "false" : outputs["regression-browser"];
  outputs["regression-browser-smoke"] = uiOnly ? "true" : "false";

  return outputs;
}

const emit = (outputs) => {
  for (const name of OUTPUT_ORDER) process.stdout.write(`${name}=${outputs[name]}\n`);
};

const changedFiles = (base) => {
  try {
    return execSync(`git diff --name-only ${base} HEAD`, {
      encoding: "utf-8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    // A failed diff (missing base, repo tangle) errs toward running
    // everything — the same conservative default the shell version had.
    process.stderr.write("::notice::diff failed — running the full matrix\n");
    return null;
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? (args[index + 1] ?? "") : "";
  };
  const event = arg("event");
  const prHeadRef = arg("pr-head-ref");

  if (event === "workflow_dispatch") {
    emit(detect({ event: "workflow_dispatch" }));
    return;
  }

  let base = event === "pull_request" ? arg("base") : arg("before");
  if (event === "push" && (base === "" || base === "0".repeat(40))) base = "HEAD~1";

  const files = changedFiles(base);
  emit(
    files === null
      ? detect({ event: "workflow_dispatch", files: [] })
      : detect({ event, prHeadRef, files }),
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
