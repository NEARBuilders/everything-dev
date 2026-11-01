import { Effect } from "effect";
import type { ImportRewrite, Manifest, PluginInventory, RouterSeam } from "./domain";
import { fileExists, listFiles, readText } from "./fs";
import { OBSOLETE_FILES } from "./obsolete-files";

export const readConfigKeys = (projectDir: string): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, "bos.config.json");
    if (!exists) return [];
    const parsed = JSON.parse(yield* readText(projectDir, "bos.config.json")) as object;
    return Object.keys(parsed);
  });

const existingOf = (projectDir: string, paths: readonly string[]) =>
  Effect.gen(function* () {
    const existing: string[] = [];
    for (const path of paths) {
      if (yield* fileExists(projectDir, path)) existing.push(path);
    }
    return existing;
  });

interface RootPluginEntry {
  readonly development?: unknown;
  readonly extends?: unknown;
  readonly variables?: Record<string, unknown>;
  readonly secrets?: unknown;
}

const localPluginName = (entry: RootPluginEntry): string | null => {
  const development = typeof entry.development === "string" ? entry.development : "";
  const match = development.match(/^local:plugins\/([^/]+)$/);
  return match?.[1] ?? null;
};

const pluginInventory = (projectDir: string): Effect.Effect<PluginInventory[], Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, "bos.config.json");
    if (!exists) return [];
    const config = JSON.parse(yield* readText(projectDir, "bos.config.json")) as {
      plugins?: Record<string, RootPluginEntry>;
    };

    const inventories: PluginInventory[] = [];
    for (const [key, entry] of Object.entries(config.plugins ?? {})) {
      const name = localPluginName(entry) ?? key;
      inventories.push({
        name,
        hasBackend: yield* fileExists(projectDir, `plugins/${name}/src/index.ts`),
        hasWeb: yield* fileExists(projectDir, `plugins/${name}/web`),
        extendsParent: typeof entry.extends === "string",
        variables: entry.variables ? Object.keys(entry.variables) : [],
        secrets: Array.isArray(entry.secrets) ? entry.secrets.map(String) : [],
      });
    }
    return inventories;
  });

export const buildManifest = (
  projectDir: string,
  tier: "A" | "B",
  blockerCount: number,
  warnCount: number,
  importRewrites: readonly ImportRewrite[],
  configKeys: readonly string[],
  routerSeam: RouterSeam,
): Effect.Effect<Manifest, Error> =>
  Effect.gen(function* () {
    const deleteFiles = yield* existingOf(projectDir, OBSOLETE_FILES);
    const plugins = yield* pluginInventory(projectDir);
    const schemaFile = yield* fileExists(projectDir, "api/src/db/schema.ts");
    const migrationFiles = yield* listFiles(projectDir, "api/src/db/migrations/**/*");
    return {
      tier,
      blockerCount,
      warnCount,
      deleteFiles,
      importRewrites: importRewrites.filter((rewrite) => rewrite.files.length > 0),
      configKeys,
      routerSeam,
      authoredConfigTarget: "bos.app.ts",
      plugins,
      db: {
        schemaFile: schemaFile ? "api/src/db/schema.ts" : null,
        migrationsDir: migrationFiles.length > 0 ? "api/src/db/migrations" : null,
      },
    } satisfies Manifest;
  });
