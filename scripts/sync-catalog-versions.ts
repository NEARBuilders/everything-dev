#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin", "better-near-auth"];

const rootDir = join(import.meta.dirname, "..");
const rootPkgPath = join(rootDir, "package.json");

const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8")) as {
  workspaces?: { catalog?: Record<string, string> };
};

if (!rootPkg.workspaces?.catalog) {
  console.error("No workspaces.catalog found in root package.json");
  process.exit(1);
}

const catalog = rootPkg.workspaces.catalog;
let changed = false;

for (const packageName of FRAMEWORK_PACKAGES) {
  const pkgJsonPath = join(rootDir, "packages", packageName, "package.json");
  let pkgVersion: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { version?: string };
    pkgVersion = pkg.version;
  } catch {
    console.warn(`Could not read ${pkgJsonPath}, skipping ${packageName}`);
    continue;
  }

  if (!pkgVersion) {
    console.warn(`No version field in ${pkgJsonPath}, skipping ${packageName}`);
    continue;
  }

  const newValue = `^${pkgVersion}`;
  if (catalog[packageName] !== newValue) {
    console.log(`${packageName}: ${catalog[packageName]} → ${newValue}`);
    catalog[packageName] = newValue;
    changed = true;
  }
}

if (changed) {
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  console.log("Catalog versions synced.");
} else {
  console.log("Catalog versions already up to date.");
}
