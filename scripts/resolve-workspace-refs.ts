#!/usr/bin/env bun

import { join } from "node:path";
import { normalizePackageManifestsInTree } from "../packages/everything-dev/src/services/registry/manifest-normalizer";

const rootDir = join(import.meta.dirname, "..");
const updatedFiles = await normalizePackageManifestsInTree({
  sourceRootDir: rootDir,
  targetDir: rootDir,
  resolveCatalogRefs: false,
  excludeFrameworkWorkspaces: true,
});

console.log(`Workspace refs resolved for ${updatedFiles.length} package.json files.`);
