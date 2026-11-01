import { Effect } from "effect";
import { Finding } from "../domain";
import { fileExists, readText } from "../fs";

export const LAYER_PATH = "api/src/db/layer.ts";

export type DbTopology = "absent" | "plugin-namespaced" | "public-topology" | "unknown";

/** The unconditional sync-owned template form: every workspace gets plugin_<slug>. */
export const PLUGIN_NAMESPACED_RE = /const\s+schemaName\s*=\s*`plugin_\$\{slug\}`\s*;/;

/** The api=public special case: `slug === "api" ? undefined : `plugin_${slug}``. */
export const PUBLIC_TOPOLOGY_RE =
  /const\s+schemaName\s*=\s*slug\s*===\s*"api"\s*\?\s*undefined\s*:\s*`plugin_\$\{slug\}`\s*;/;

export const detectDbTopology = (source: string): DbTopology => {
  if (PUBLIC_TOPOLOGY_RE.test(source)) return "public-topology";
  if (PLUGIN_NAMESPACED_RE.test(source)) return "plugin-namespaced";
  return "unknown";
};

export const readDbTopology = (projectDir: string): Effect.Effect<DbTopology, Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, LAYER_PATH);
    if (!exists) return "absent";
    return detectDbTopology(yield* readText(projectDir, LAYER_PATH));
  });

export const checkDbTopology = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const topology = yield* readDbTopology(projectDir);
    if (topology === "public-topology" || topology === "absent") return [];

    if (topology === "unknown") {
      return [
        new Finding({
          check: "db-topology",
          path: LAYER_PATH,
          severity: "warn",
          message:
            "api/src/db/layer.ts matches neither the plugin-namespaced template nor the api=public fix — inspect manually; the patch step will not touch it",
        }),
      ];
    }

    return [
      new Finding({
        check: "db-topology",
        path: LAYER_PATH,
        severity: "warn",
        message:
          "the sync-owned db layer template namespaces the api's data into plugin_api — this contradicts `bos db doctor` (checks the public schema), the drizzle-kit config (no schemaNames → public), and every v1-upgraded database (tables in public with a full journal): hash-edited migrations re-run into plugin_api, drift goes drift-manual, and the api plugin refuses to boot. Run `pnpm db-topology` to patch, and see the upstream layer-template ticket",
      }),
    ];
  });
