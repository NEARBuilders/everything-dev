#!/usr/bin/env node

import { join } from "node:path";
import { syncWorkspaceSkillLibraryVersions } from "../packages/everything-dev/src/skill-library-versions";

const rootDir = join(import.meta.dirname, "..");

const changed = syncWorkspaceSkillLibraryVersions(rootDir);
if (changed.length === 0) {
  console.log("Skill library_version markers already up to date.");
} else {
  for (const entry of changed) {
    console.log(`${entry.file}: ${entry.from} → ${entry.to}`);
  }
  console.log("Skill library_version markers synced.");
}
