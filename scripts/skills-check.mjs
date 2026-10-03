#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const lock = JSON.parse(readFileSync("skills-lock.json", "utf-8"));
const skillsDir = ".agents/skills";
const repoAuthored = new Set(["everything-dev-app", "fastkv-registry"]);

const missing = [];
const extra = [];
let exitCode = 0;

for (const name of Object.keys(lock.skills)) {
  if (!existsSync(join(skillsDir, name, "SKILL.md"))) {
    missing.push(name);
  }
}

for (const entry of existsSync(skillsDir)
  ? await import("node:fs").then((fs) => fs.readdirSync(skillsDir))
  : []) {
  if (repoAuthored.has(entry) || lock.skills[entry]) continue;
  if (existsSync(join(skillsDir, entry, "SKILL.md"))) extra.push(entry);
}

if (missing.length > 0) {
  console.error(`In skills-lock.json but missing on disk: ${missing.join(", ")}`);
  exitCode = 1;
}
if (extra.length > 0) {
  console.error(`On disk but not in skills-lock.json: ${extra.join(", ")}`);
  console.error(
    "(Add via `npx skills add <source>` or extend the repoAuthored allowlist in scripts/skills-check.mjs.)",
  );
  exitCode = 1;
}
if (exitCode === 0) {
  console.log(
    `skills-lock.json ↔ .agents/skills in sync (${Object.keys(lock.skills).length} locked skills)`,
  );
}
process.exit(exitCode);
