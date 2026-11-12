#!/usr/bin/env node

// Changeset-target guard (#572): changesets are the release lever for the
// publishable framework packages only. A changeset naming only private
// workspaces versions nothing and is silently consumed — reject it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dirname, "..");

const changesetDir = join(rootDir, ".changeset");
const files = readdirSync(changesetDir).filter(
  (name) => name.endsWith(".md") && name !== "README.md",
);
if (files.length === 0) process.exit(0);

const publishable = new Set(
  readdirSync(join(rootDir, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return JSON.parse(
          readFileSync(join(rootDir, "packages", entry.name, "package.json"), "utf8"),
        ).name;
      } catch {
        return null;
      }
    })
    .filter(Boolean),
);

const offenders = [];
for (const file of files) {
  const body = readFileSync(join(changesetDir, file), "utf8");
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(body)?.[1] ?? "";
  const named = [...frontMatter.matchAll(/"([^"]+)":\s*(?:patch|minor|major)/g)].map((m) => m[1]);
  if (named.length > 0 && named.every((name) => !publishable.has(name))) {
    offenders.push(`${file}: ${named.join(", ")}`);
  }
}

if (offenders.length > 0) {
  console.error(
    [
      "Changesets must target the publishable framework packages:",
      ...offenders.map((line) => `  ${line}`),
      "",
      "Write it against everything-dev, or don't write one.",
      "(A changeset on a private workspace versions nothing — small changes ride",
      "continuous deploys and are swept up by the next release.)",
    ].join("\n"),
  );
  process.exit(1);
}
