#!/usr/bin/env node
// One-command bootstrap for fresh checkouts (#958): a fresh clone/worktree
// reaches "hooks pass, typecheck green, unit tests runnable" with no manual
// ordering, and re-running on a healthy checkout is a fast no-op. Heavy steps
// are gated by markers; the toolchain self-heal is delegated to
// scripts/ensure-effect-toolchain.mjs (via `pnpm run prepare`) — this script
// does not duplicate its repairs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const lockfile = join(root, "pnpm-lock.yaml");
const installMarker = join(root, ".bos/locks/setup-install");
const genMarker = join(root, ".bos/generated/runtime-map.json");
const EFFECT_REPO_URL = "https://github.com/Effect-TS/effect.git";

const step = (name, detail) => console.log(`setup: ${name}${detail ? ` — ${detail}` : ""}`);
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const die = (problems, remedy) => {
  console.error("error: `pnpm run setup` could not finish:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`fix it with:\n  ${remedy}`);
  process.exit(1);
};

const run = (name, cmd, args, remedy) => {
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    die([`${name} could not start (${result.error.message})`], remedy);
  }
  if (result.status !== 0) {
    die([`${name} failed (exit code ${result.status ?? "killed by signal"})`], remedy);
  }
  return Date.now() - started;
};

const startedAt = Date.now();

const pnpmCheck = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf-8" });
if (pnpmCheck.error || pnpmCheck.status !== 0) {
  die(
    ["pnpm is not on PATH (or not executable)"],
    "enable it with `corepack enable` (this repo pins pnpm via the packageManager field), then re-run `pnpm run setup`",
  );
}

if (!existsSync(lockfile)) {
  die(
    ["pnpm-lock.yaml is missing — this checkout is incomplete"],
    "re-clone the repository, then re-run `pnpm run setup`",
  );
}

const lockHash = createHash("sha256").update(readFileSync(lockfile)).digest("hex");
const markerHash = existsSync(installMarker) ? readFileSync(installMarker, "utf-8").trim() : null;
const installNeeded =
  markerHash !== lockHash || !existsSync(join(root, "node_modules/.bin/oxlint"));
if (installNeeded) {
  const coldStore = !existsSync(join(root, "node_modules"));
  step(
    "install",
    coldStore ? "first install in this checkout" : "lockfile changed since the last install",
  );
  const elapsed = run(
    "pnpm install",
    "pnpm",
    ["install"],
    "the install failed — the error pnpm printed above names the failing package/workspace; fix it (or reset with `rm -rf node_modules` for a clean retry) and re-run `pnpm run setup`",
  );
  step(
    "install",
    `done in ${seconds(elapsed)}${coldStore ? " (a cold pnpm store downloads the full dependency graph — later installs are much faster)" : ""}`,
  );
  mkdirSync(join(root, ".bos/locks"), { recursive: true });
  writeFileSync(installMarker, lockHash);
} else {
  step("install", "up to date (skipped)");
}

step("prepare", "Effect toolchain self-heal + lefthook hooks");
run(
  "pnpm run prepare",
  "pnpm",
  ["run", "prepare"],
  `the toolchain self-heal failed — unless the checkout is already healthy it needs network access to ${EFFECT_REPO_URL} (the vendored Effect clone); check connectivity and re-run \`pnpm run setup\``,
);

const genInputs = [join(root, "bos.app.ts"), join(root, "api/src/contract.ts")];
for (const plugin of readdirSync(join(root, "plugins"))) {
  const contract = join(root, "plugins", plugin, "src/contract.ts");
  if (existsSync(contract)) genInputs.push(contract);
}
const markerMtime = existsSync(genMarker) ? statSync(genMarker).mtimeMs : null;
const staleInputs =
  markerMtime === null
    ? []
    : genInputs.filter((input) => {
        return existsSync(input) && statSync(input).mtimeMs > markerMtime;
      });
if (markerMtime === null) {
  step("generated types", "none in this checkout yet");
} else if (staleInputs.length > 0) {
  step(
    "generated types",
    `stale (newer than the last generation: ${staleInputs.map((input) => relative(root, input)).join(", ")})`,
  );
} else {
  step("generated types", "fresh (skipped)");
}
if (markerMtime === null || staleInputs.length > 0) {
  run(
    "bos types gen",
    "pnpm",
    ["run", "bos", "types", "gen"],
    "type generation failed — the error above names the authored config (bos.app.ts) or plugin contract that broke it; fix it and re-run `pnpm run setup`",
  );
}

step("verify", "lint:effect + api typecheck smoke");
run(
  "pnpm run lint:effect",
  "pnpm",
  ["run", "lint:effect"],
  "fix the Effect-lint errors printed above, then re-run `pnpm run setup`",
);
// The smoke is the api workspace on purpose: it is the cheapest local
// workspace whose typecheck still consumes the generated plugin/auth types,
// so green proves the patched tsc, the resolution, and the generated
// artifacts in one run. The full `pnpm run typecheck` remains the pre-push
// gate — setup must not duplicate its minutes.
run(
  "typecheck smoke (api)",
  "pnpm",
  ["--filter", "api", "run", "typecheck"],
  "the smoke typecheck failed — run `pnpm run typecheck` for the full picture, fix the errors, then re-run `pnpm run setup`",
);

step(
  "done",
  `hooks installed, lint:effect green, api typecheck smoke green — ${seconds(Date.now() - startedAt)} total; unit tests are runnable (\`pnpm run test:ui\`, \`test:api\`, \`test:framework\`)`,
);
