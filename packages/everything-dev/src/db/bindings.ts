import { resolve } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import type { RuntimeConfig } from "../types";
import { getDatabaseUrlSecretName, getMigrationStorage, pluginMigrationSlug } from "./core";
import { type WorkspaceIdentity, workspaceIdentityFromWorkspaceDir } from "./identity";

export interface DatabaseBinding {
  readonly key: string;
  readonly source: "local" | "remote";
  readonly section: "app.api" | "app.auth" | "plugins";
  readonly identity: WorkspaceIdentity;
  readonly url: string;
}

export class DatabaseBindingError extends Data.TaggedError("DatabaseBindingError")<{
  readonly pluginKey: string;
  readonly message: string;
}> {}

export interface DatabaseBindingsService {
  readonly forPluginKey: (
    pluginKey: string,
  ) => Effect.Effect<DatabaseBinding, DatabaseBindingError>;
}

export class DatabaseBindings extends Context.Service<DatabaseBindings, DatabaseBindingsService>()(
  "everything-dev/DatabaseBindings",
) {}

interface RuntimePluginEntry {
  readonly source?: string;
  readonly secrets?: string[];
  readonly localPath?: string;
}

function resolvePluginBinding(
  pluginKey: string,
  runtimeConfig: RuntimeConfig | null,
  projectDir: string,
  env: Record<string, string | undefined>,
): DatabaseBinding {
  if (!runtimeConfig) {
    throw new Error("Runtime config not loaded — cannot resolve plugin database binding");
  }

  let source: "local" | "remote" | undefined;
  let section: DatabaseBinding["section"];
  let secrets: string[] | undefined;
  let localPath: string | undefined;
  let key: string;

  if (pluginKey === "api" && runtimeConfig.api) {
    source = runtimeConfig.api.source as "local" | "remote";
    section = "app.api";
    secrets = runtimeConfig.api.secrets;
    localPath = runtimeConfig.api.localPath;
    key = "api";
  } else if (pluginKey === "auth" && runtimeConfig.auth) {
    source = runtimeConfig.auth.source as "local" | "remote";
    section = "app.auth";
    secrets = runtimeConfig.auth.secrets;
    localPath = runtimeConfig.auth.localPath;
    key = "auth";
  } else if (runtimeConfig.plugins?.[pluginKey]) {
    const plugin = runtimeConfig.plugins[pluginKey] as RuntimePluginEntry;
    source = plugin.source as "local" | "remote";
    section = "plugins";
    secrets = plugin.secrets;
    localPath = plugin.localPath;
    key = pluginKey;
  } else {
    const available = [
      "api",
      ...(runtimeConfig.auth ? ["auth"] : []),
      ...Object.keys(runtimeConfig.plugins ?? {}),
    ].join(", ");
    throw new Error(
      `Plugin "${pluginKey}" not found in app.api, app.auth, or plugins. Available: ${available}`,
    );
  }

  const identity: WorkspaceIdentity = localPath
    ? workspaceIdentityFromWorkspaceDir(resolve(projectDir, localPath))
    : {
        slug: pluginMigrationSlug(key),
        secretName: getDatabaseUrlSecretName(pluginMigrationSlug(key)),
        journal: getMigrationStorage(pluginMigrationSlug(key)),
        workspaceDir: undefined,
      };

  const url = env[identity.secretName];
  if (!url) {
    const declaredDatabaseSecrets = (secrets ?? []).filter((s) => s.endsWith("_DATABASE_URL"));
    const mismatch =
      declaredDatabaseSecrets.length > 0 && !declaredDatabaseSecrets.includes(identity.secretName)
        ? ` Config declares ${declaredDatabaseSecrets.join(", ")} — the workspace package name and the declared secret disagree.`
        : "";
    throw new Error(
      `.env missing ${identity.secretName} for plugin "${key}".` +
        mismatch +
        ` Add it to your .env file (see .env.example).`,
    );
  }

  return {
    key,
    source: source ?? "remote",
    section,
    identity,
    url,
  };
}

export interface DatabaseBindingsOptions {
  readonly projectDir: string;
  readonly loadRuntimeConfig: () => Promise<RuntimeConfig | null>;
  /** May return a promise — a rejection propagates into the binding error instead of silently proceeding with an unloaded .env. */
  readonly loadEnv?: () => void | Promise<void>;
  readonly env?: Record<string, string | undefined>;
}

export const makeDatabaseBindings = (
  options: DatabaseBindingsOptions,
): Layer.Layer<DatabaseBindings> =>
  Layer.succeed(DatabaseBindings, {
    forPluginKey: (pluginKey) =>
      Effect.tryPromise({
        try: async () => {
          await options.loadEnv?.();
          const runtimeConfig = await options.loadRuntimeConfig();
          return resolvePluginBinding(
            pluginKey,
            runtimeConfig,
            options.projectDir,
            options.env ?? process.env,
          );
        },
        catch: (error) =>
          new DatabaseBindingError({
            pluginKey,
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
  });
