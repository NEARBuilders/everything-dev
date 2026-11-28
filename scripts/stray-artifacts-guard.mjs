#!/usr/bin/env node

// Stray build-artifact guard (#923): builds must never emit declarations or
// compiled JS beside TypeScript sources. The historical nuisance — tsdown
// regenerating src/**/*.d.ts in packages/every-plugin — no longer reproduces
// on tsdown 0.22.14 (fixed by the 2026-04-23 bump, commit 2b86efd6); this
// guard makes sure a future toolchain bump cannot silently reintroduce it.
// Untracked-only detection keeps authored files (ambient .d.ts etc.) safe.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");

const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
  cwd: rootDir,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const artifactPattern = /\.(d\.ts|d\.mts|d\.cts|js|mjs|cjs)(\.map)?$/;

const offenders = untracked.filter(
  (path) => /(^|\/)src\//.test(path) && artifactPattern.test(path),
);

if (offenders.length > 0) {
  console.error("stray-artifacts-guard: build artifacts appeared beside sources (untracked):");
  for (const path of offenders) {
    console.error(`  ${path}`);
  }
  console.error(
    "\nA build step is emitting into a src/ tree. Fix the emitting build config, then remove the files:\n" +
      `  git clean -f -- ${offenders.join(" ")}`,
  );
  process.exit(1);
}
