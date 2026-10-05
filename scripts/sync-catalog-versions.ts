#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWorkspaceCatalog,
  writeWorkspaceCatalog,
} from "../packages/everything-dev/src/workspace-catalog";

const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin", "better-near-auth"];

const rootDir = join(import.meta.dirname, "..");

const catalog = readWorkspaceCatalog(rootDir);
if (Object.keys(catalog).length === 0) {
  console.error("No catalog found in pnpm-workspace.yaml");
  process.exit(1);
}

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
  writeWorkspaceCatalog(rootDir, catalog);
  console.log("Catalog versions synced.");
} else {
  console.log("Catalog versions already up to date.");
}
