import fs from "node:fs";
import path from "node:path";
import type { RsbuildPlugin } from "@rsbuild/core";
import {
  BuildEntryReportSchema,
  findHashedEntry,
  MF_MANIFEST_FILENAME,
  planArtifactCopies,
  STYLE_FILENAME,
} from "../artifact-names";

export interface HashArtifactsPluginOptions {
  /** The container entry's base name in this environment's dist root. */
  entryBase: string;
  /** Absolute dist root this environment wrote (web: `dist`, node: `dist/ssr`). */
  distRoot: string;
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(path.relative(dir, full).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Emits the additive hashed copies for one environment's dist root (ticket:
 * atomic-deploys 01). The entry itself is hashed by the build (filename
 * template); this plugin adds immutable hashed copies of the fixed-name
 * browser artifacts (mf-manifest.json at the root, style.css under
 * static/css), and `build-report.json` for the deploy leg. Idempotent under
 * watch: same bytes → same hashed names.
 */
export function hashArtifactsPlugin(options: HashArtifactsPluginOptions): RsbuildPlugin {
  return {
    name: "hash-artifacts",
    setup(api) {
      api.onAfterEnvironmentCompile(() => {
        const distRoot = options.distRoot;
        if (!fs.existsSync(distRoot)) return;

        const resolveExisting = (name: string): string | null => {
          const candidates = [
            path.join(distRoot, name),
            path.join(distRoot, "static", "css", name),
          ];
          return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
        };

        const assetNames = listFiles(distRoot);
        const entry = findHashedEntry(assetNames, options.entryBase);
        if (!entry) return;

        const contents: Record<string, string> = {};
        for (const fixedName of [MF_MANIFEST_FILENAME, STYLE_FILENAME]) {
          const from = resolveExisting(fixedName);
          if (from) contents[fixedName] = fs.readFileSync(from, "utf8");
        }

        const plan = planArtifactCopies({ assetNames, entryBase: options.entryBase, contents });
        if (!plan) return;

        for (const copy of plan.copies) {
          const from = resolveExisting(copy.from);
          if (!from) throw new Error(`[hash-artifacts] planned copy source missing: ${copy.from}`);
          fs.copyFileSync(from, path.join(distRoot, copy.to));
        }
        fs.writeFileSync(
          path.join(distRoot, "build-report.json"),
          `${JSON.stringify(BuildEntryReportSchema.parse(plan.report), null, 2)}\n`,
        );
      });
    },
  };
}
