import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { entries } from "../tsdown-entries.ts";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

export function generateExports(): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  for (const spec of entries) {
    if (!spec.export) continue;
    const src = `./${spec.entry}`;
    const distBase = `./${spec.entry.replace(/^src\//, "dist/").replace(/\.ts$/, "")}`;
    const dist: Record<string, unknown> = {
      types: `${distBase}.d.mts`,
      import: `${distBase}.mjs`,
    };
    if (spec.require !== false) {
      dist.require = `${distBase}.cjs`;
    }
    exports[spec.export] = {
      bun: { types: src, import: src },
      development: { types: src, import: src },
      ...dist,
    };
  }
  exports["./package.json"] = "./package.json";
  return exports;
}

export async function syncExports({ check = false } = {}): Promise<boolean> {
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as { exports?: Record<string, unknown> };
  const generated = generateExports();

  if (JSON.stringify(pkg.exports) === JSON.stringify(generated)) {
    if (!check) console.log("[sync-exports] exports map already in sync with tsdown-entries.ts");
    return false;
  }

  if (check) {
    console.error(
      "[sync-exports] package.json exports map is out of sync with tsdown-entries.ts — run `bun run --cwd packages/every-plugin exports:sync`",
    );
    return true;
  }

  const sorted = Object.fromEntries(
    Object.entries(pkg).map(([key, value]) => [key, key === "exports" ? generated : value]),
  ) as typeof pkg;
  await writeFile(packageJsonPath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log("[sync-exports] stamped package.json exports map from tsdown-entries.ts");
  return false;
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const check = process.argv.includes("--check");
  const drifted = await syncExports({ check });
  process.exit(drifted ? 1 : 0);
}
