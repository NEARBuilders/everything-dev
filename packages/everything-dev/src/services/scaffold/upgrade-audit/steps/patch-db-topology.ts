import { Effect } from "effect";
import { detectDbTopology, LAYER_PATH } from "../checks/db-topology";
import { fileExists, readText, writeText } from "../fs";
import type { StepResult } from "./author-config";

/**
 * Patches the sync-owned api db layer back onto the public-schema topology
 * for the api workspace. The upstream template namespaces every workspace
 * into `plugin_<slug>`, but the api's own surfaces all assume public:
 * `bos db doctor` checks the public schema, the drizzle-kit config targets
 * public (no schemaNames), and every v1-upgraded database has its tables in
 * public with a full journal. Under the template, hash-edited migrations
 * re-run into plugin_api, drift goes drift-manual, and the api plugin
 * refuses to boot ("Serving without the API: all /api/* routes return 503").
 *
 * Maintenance step for post-upgrade trees and a bos sync regression guard:
 * `pnpm db-topology [--dry-run]`
 */
export const patchDbTopology = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, LAYER_PATH);
    if (!exists) {
      return {
        writes: [],
        deletes: [],
        notes: ["api/src/db/layer.ts absent — nothing to patch"],
      };
    }

    const source = yield* readText(projectDir, LAYER_PATH);
    const topology = detectDbTopology(source);

    if (topology === "public-topology") {
      return {
        writes: [],
        deletes: [],
        notes: ["db layer already keeps the api on public-schema topology"],
      };
    }
    if (topology === "unknown") {
      return {
        writes: [],
        deletes: [],
        notes: ["schemaName derivation not recognized — left untouched, inspect manually"],
      };
    }

    let next = source.replace(
      /const\s+schemaName\s*=\s*`plugin_\$\{slug\}`\s*;/,
      [
        "// The api keeps the v1 public-schema topology (what `bos db doctor` checks",
        "// and the drizzle-kit config targets); plugins scope into plugin_<slug>.",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text spliced into layer.ts
        'const schemaName = slug === "api" ? undefined : `plugin_${slug}`;',
      ].join("\n"),
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source text spliced into layer.ts
    next = next.replace(/schema:\s*\$\{schemaName\}/, 'schema: ${schemaName ?? "public"}');

    if (!dryRun) yield* writeText(projectDir, LAYER_PATH, next);
    return {
      writes: [LAYER_PATH],
      deletes: [],
      notes: [
        'api db layer patched to public-schema topology (slug === "api" → undefined schemaName)',
        "sync-owned file — bos sync will restore the plugin_<slug> template until the upstream fix lands; re-run this step after syncs",
      ],
    };
  });
