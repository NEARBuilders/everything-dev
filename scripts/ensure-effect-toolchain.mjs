#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const EFFECT_REPO_URL = "https://github.com/Effect-TS/effect.git";
const effectRepo = join(root, "repos/effect");
const oxcLink = join(root, "node_modules/@effect/oxc");
const OXC_LINK_TARGET = "../../repos/effect/packages/tools/oxc";

const fail = (problems, remedy) => {
  console.error("error: the Effect toolchain in this checkout is not usable:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`fix it with:\n  ${remedy}`);
  process.exit(1);
};

const readEffectPin = () => {
  const workspace = readFileSync(join(root, "pnpm-workspace.yaml"), "utf-8");
  const match = workspace.match(/^ {2}effect: (\S+)\s*$/m);
  return match?.[1] ?? null;
};

const dirContainsFileEnding = (parent, dirPrefix, fileSuffix, subdirs = [""]) => {
  if (!existsSync(parent)) return false;
  for (const entry of readdirSync(parent)) {
    if (!entry.startsWith(dirPrefix)) continue;
    for (const subdir of subdirs) {
      try {
        for (const file of readdirSync(join(parent, entry, subdir))) {
          if (file.endsWith(fileSuffix)) return true;
        }
      } catch {}
    }
  }
  return false;
};

const patchMarkersPresent = () =>
  dirContainsFileEnding(join(root, "node_modules/@typescript"), "typescript-", "tsc.original", [
    "",
    "lib",
  ]) &&
  dirContainsFileEnding(join(root, "node_modules/@oxlint"), "binding-", ".node.original") &&
  dirContainsFileEnding(join(root, "node_modules/@oxlint-tsgolint"), "", "tsgolint.original");

const problems = () => {
  const found = [];
  if (!existsSync(join(root, "node_modules/.bin/oxlint"))) {
    found.push("dependencies are not installed (node_modules/.bin/oxlint missing)");
  }
  if (!existsSync(join(effectRepo, ".git"))) {
    found.push("repos/effect (the gitignored vendored Effect clone) is missing");
  }
  if (!existsSync(oxcLink)) {
    found.push("node_modules/@effect/oxc does not resolve (missing or dangling symlink)");
  }
  if (!patchMarkersPresent()) {
    found.push("the effect-tsgo patch is absent from the installed oxlint/tsc binaries");
  }
  return found;
};

const cloneEffectRepo = (tag) => {
  const staging = join(root, `repos/effect.tmp-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", `effect@${tag}`, EFFECT_REPO_URL, staging],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  try {
    renameSync(staging, effectRepo);
  } catch (error) {
    if (!existsSync(join(effectRepo, ".git"))) throw error;
    rmSync(staging, { recursive: true, force: true });
  }
};

const patchToolchain = () => {
  execFileSync(
    process.execPath,
    [join(root, "node_modules/@effect/tsgo/dist/effect-tsgo.cjs"), "patch", "--oxlint"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
};

const patchLockDir = join(root, ".bos/locks/effect-toolchain-patch");

const acquirePatchLock = () => {
  try {
    mkdirSync(patchLockDir, { recursive: false });
    return true;
  } catch {
    return false;
  }
};

const runPatchUnderLock = async () => {
  mkdirSync(join(root, ".bos/locks"), { recursive: true });
  const deadline = Date.now() + 60000;
  while (!acquirePatchLock()) {
    if (patchMarkersPresent()) return;
    if (Date.now() > deadline) {
      rmSync(patchLockDir, { recursive: true, force: true });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try {
    patchToolchain();
  } finally {
    rmSync(patchLockDir, { recursive: true, force: true });
  }
};

const relinkOxc = () => {
  rmSync(oxcLink, { force: true });
  mkdirSync(join(root, "node_modules/@effect"), { recursive: true });
  symlinkSync(OXC_LINK_TARGET, oxcLink, "dir");
};

const ciMode = process.env.CI === "true" || process.env.BOS_CI === "1";
const CI_REMEDY = "the workflow must run `pnpm run prepare` after `pnpm install --ignore-scripts`";
const LOCAL_REMEDY = "pnpm install && pnpm run prepare";

const initial = problems();
if (initial.length === 0) process.exit(0);

const installMissing = initial.some((problem) => problem.startsWith("dependencies"));
if (installMissing) {
  fail(initial, LOCAL_REMEDY);
}

if (!ciMode) {
  console.log(
    `ensure-effect-toolchain: repairing ${initial.length} problem${initial.length === 1 ? "" : "s"}`,
  );
}

const needsClone = initial.some((problem) => problem.startsWith("repos/effect"));
if (needsClone) {
  if (ciMode) {
    fail(initial, CI_REMEDY);
  }
  const pin = readEffectPin();
  if (pin === null) {
    fail(
      [
        ...initial,
        "pnpm-workspace.yaml has no top-level catalog.effect pin — the vendored clone tag is undeterminable",
      ],
      LOCAL_REMEDY,
    );
  }
  try {
    cloneEffectRepo(pin);
  } catch {
    console.error(
      "ensure-effect-toolchain: git clone failed — re-checking health before giving up",
    );
  }
}

if (!patchMarkersPresent()) {
  try {
    await runPatchUnderLock();
  } catch {
    console.error(
      "ensure-effect-toolchain: effect-tsgo patch failed — re-checking health before giving up",
    );
  }
}

if (!existsSync(oxcLink)) {
  try {
    relinkOxc();
  } catch {
    console.error(
      "ensure-effect-toolchain: @effect/oxc relink failed — re-checking health before giving up",
    );
  }
}

const remaining = problems();
if (remaining.length === 0) {
  console.log(
    "ensure-effect-toolchain: repaired — vendored Effect present, oxlint/tsc patched, @effect/oxc linked",
  );
  process.exit(0);
}
fail(remaining, ciMode ? CI_REMEDY : LOCAL_REMEDY);
