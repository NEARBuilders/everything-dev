#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { globSync } from "glob";
import { stageReleasePackages } from "../packages/everything-dev/src/internal/manifest-normalizer";

const rootDir = join(import.meta.dirname, "..");
const outDir = join(rootDir, ".release");

const packageNames = globSync("packages/*/package.json", { cwd: rootDir, nodir: true })
  .filter((filePath) => existsSync(join(rootDir, filePath)))
  .filter((filePath) => {
    const pkg = JSON.parse(readFileSync(join(rootDir, filePath), "utf-8")) as { private?: boolean };
    return pkg.private !== true;
  })
  .map((filePath) => basename(dirname(filePath)));

stageReleasePackages({
  repoRoot: rootDir,
  outDir,
  packageNames,
});

console.log(`Release packages staged in ${outDir}`);
