import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

interface WorkspaceFile {
  catalog?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
}

const OVERRIDES_PINS = ["@effect/platform-node", "@effect/platform-node-shared"] as const;

function readOverridePins(workspace: WorkspaceFile): Record<string, string | undefined> {
  const pins: Record<string, string | undefined> = {};
  for (const name of OVERRIDES_PINS) {
    pins[name] =
      typeof workspace.overrides?.[name] === "string"
        ? (workspace.overrides[name] as string)
        : undefined;
  }
  return pins;
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", "repos/effect", ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

let exitCode = 0;

const workspace = parse(readFileSync("pnpm-workspace.yaml", "utf-8")) as WorkspaceFile;
const catalogEffect =
  typeof workspace.catalog?.effect === "string" ? workspace.catalog.effect : null;
const overridePins = readOverridePins(workspace);

const pinSources: Array<{ location: string; value: string | null }> = [
  { location: "pnpm-workspace.yaml catalog.effect", value: catalogEffect },
  ...OVERRIDES_PINS.map((name) => ({
    location: `pnpm-workspace.yaml overrides["${name}"]`,
    value: overridePins[name] ?? null,
  })),
];

const distinct = new Set(pinSources.map((entry) => entry.value));
if (distinct.size > 1 || catalogEffect === null) {
  console.error(
    "the vendored-Effect rc pin disagrees across its locations — bump all three together:",
  );
  for (const entry of pinSources) {
    console.error(`  ${entry.location}: ${entry.value ?? "(missing)"}`);
  }
  exitCode = 1;
}

const effectPin = catalogEffect;
if (effectPin === null) {
  console.error(
    "pnpm-workspace.yaml has no catalog.effect pin — the vendored clone is uncheckable",
  );
  exitCode = 1;
}

if (!existsSync("repos/effect/.git")) {
  console.log("vendored clone absent — prepare will create it");
  process.exit(exitCode);
}

if (exitCode !== 0 || effectPin === null) {
  process.exit(exitCode);
}

const head = gitOutput(["rev-parse", "HEAD"]);
const tag = `effect@${effectPin}`;
const tagCommit = gitOutput(["rev-parse", "--verify", `${tag}^{commit}`]);

if (!head) {
  console.error(
    "repos/effect is not a readable git clone — delete repos/ and re-run pnpm run prepare",
  );
  process.exit(1);
}
if (!tagCommit) {
  console.error(
    `repos/effect does not carry the tag ${tag} — the vendored clone is stale (catalog.effect is ${effectPin}):\n` +
      `  git -C repos/effect fetch --tags && git -C repos/effect checkout ${tag}\n` +
      "  or delete repos/ and re-run pnpm run prepare",
  );
  process.exit(1);
}
if (tagCommit !== head) {
  console.error(
    `repos/effect HEAD is not at ${tag} (catalog.effect is ${effectPin}):\n` +
      `  git -C repos/effect fetch --tags && git -C repos/effect checkout ${tag}\n` +
      "  or delete repos/ and re-run pnpm run prepare",
  );
  process.exit(1);
}

console.log(`vendored Effect clone at ${tag} (${head.slice(0, 12)})`);
process.exit(0);
