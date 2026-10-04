import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { Context } from "effect";
import { getPluginRef } from "../build";
import { generateCodeArtifacts } from "../code-artifacts";
import { MISSING_CONFIG_MESSAGE } from "../config";
import type { PluginListResult } from "../contract";
import { fetchRemotePluginManifest } from "../fastkv";
import { publishToFastKv } from "../publish";
import { openResolution } from "../resolution/session";
import type { BosConfig } from "../types";
import { saveBosConfig } from "../utils/save-config";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerPlugins(builder: BosBuilder) {
  return {
    pluginAdd: builder.pluginAdd.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          key: "",
          error: MISSING_CONFIG_MESSAGE,
        };
      }

      const isBosRef = input.source.startsWith("bos://");
      const isLocal = input.source.startsWith("local:");
      const key = sanitizePluginKey(
        input.as ??
          (isBosRef ? (input.source.split("/").pop() ?? "plugin") : defaultPluginKey(input.source)),
      );
      const existing = session.config.plugins?.[key];
      const existingEntry = existing && typeof existing === "object" ? existing : {};
      const applyEntryDelta = (base: Record<string, unknown>): Record<string, unknown> => {
        if (isBosRef) return { ...base, extends: input.source };
        if (isLocal) return { ...base, development: input.source };
        return { ...base, production: input.production ?? input.source };
      };
      const nextPlugins = { ...session.config.plugins };
      nextPlugins[key] = applyEntryDelta(existingEntry);

      const nextConfig: BosConfig = {
        ...session.config,
        plugins: nextPlugins,
      };

      const authored = session.rawConfig;
      if (authored) {
        // Authoring-surface save: the authored leaf input + delta, never the
        // resolved config (which would bake inherited values into the file).
        const authoredExisting = authored.plugins?.[key];
        const authoredBase: Record<string, unknown> =
          typeof authoredExisting === "string"
            ? { extends: authoredExisting }
            : authoredExisting && typeof authoredExisting === "object"
              ? (authoredExisting as Record<string, unknown>)
              : {};
        await saveBosConfig(session.root, {
          ...authored,
          plugins: {
            ...(authored.plugins ?? {}),
            [key]: applyEntryDelta(authoredBase),
          },
        });
      } else {
        await saveBosConfig(session.root, nextConfig);
      }
      await generateCodeArtifacts(session.root, nextConfig);

      const stored = nextConfig.plugins?.[key];
      const storedObj = stored && typeof stored === "object" ? stored : {};

      return {
        status: "added" as const,
        key,
        development: storedObj.development,
        production: storedObj.production,
        integrity: storedObj.integrity,
        version: storedObj.version,
      };
    }),

    pluginRemove: builder.pluginRemove.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          key: input.key,
          error: MISSING_CONFIG_MESSAGE,
        };
      }

      if (!session.config.plugins?.[input.key]) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' is not configured`,
        };
      }

      const nextPlugins = { ...session.config.plugins };
      delete nextPlugins[input.key];
      const nextConfig: BosConfig = {
        ...session.config,
        plugins: Object.keys(nextPlugins).length > 0 ? nextPlugins : undefined,
      };

      const authored = session.rawConfig;
      if (authored) {
        const authoredPlugins: Record<string, unknown> = { ...(authored.plugins ?? {}) };
        if (authoredPlugins[input.key] === undefined) {
          // Inherited from the parent runtime. JSON-form children can express
          // removal with a null sentinel (dropped by the extends merge); the
          // TS descriptor schema cannot, so only those error out.
          if (existsSync(join(session.root, "bos.app.ts"))) {
            return {
              status: "error" as const,
              key: input.key,
              error: `'${input.key}' is inherited from the parent runtime — remove it in the parent config or override it there (the authored descriptor cannot express removal)`,
            };
          }
          authoredPlugins[input.key] = null;
        } else {
          delete authoredPlugins[input.key];
        }
        await saveBosConfig(session.root, {
          ...authored,
          plugins: Object.keys(authoredPlugins).length > 0 ? authoredPlugins : undefined,
        });
      } else {
        await saveBosConfig(session.root, nextConfig);
      }
      await generateCodeArtifacts(session.root, nextConfig);

      return {
        status: "removed" as const,
        key: input.key,
      };
    }),

    pluginList: builder.pluginList.handler(async ({ context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const plugins: PluginListResult["plugins"] = listPluginAttachments(
        deps.session?.config ?? null,
      );
      return {
        status: "listed" as const,
        plugins,
      };
    }),

    pluginPublish: builder.pluginPublish.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const session = deps.session;
      if (!session?.config) {
        return {
          status: "error" as const,
          key: input.key,
          error: MISSING_CONFIG_MESSAGE,
        };
      }

      const attachment = session.config?.plugins?.[input.key];
      if (!attachment) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' is not configured`,
        };
      }

      const localPath = pluginLocalPath(session.root, attachment);
      if (!localPath) {
        return {
          status: "error" as const,
          key: input.key,
          error: `Plugin '${input.key}' does not have a local development path`,
        };
      }

      const result = await publishToFastKv({
        bosConfig: session.config,
        runtimeConfig: session.runtime,
        configDir: session.root,
        env: "production",
        build: true,
        dryRun: false,
        verbose: false,
        packages: input.key,
      });
      if (result.status === "error") {
        return {
          status: "error" as const,
          key: input.key,
          error: result.error,
        };
      }

      const nextSession = (await openResolution({ cwd: session.root })) ?? session;
      const production = (
        nextSession.config?.plugins?.[input.key] as
          | {
              production?: string;
            }
          | undefined
      )?.production;

      const manifest = production ? await fetchRemotePluginManifest(production) : null;
      if (production && nextSession.config) {
        await generateCodeArtifacts(session.root, nextSession.config);
      }

      return {
        status: "published" as const,
        key: input.key,
        path: localPath,
        production,
        fingerprint: result.fingerprint,
        version: manifest?.plugin.version,
      };
    }),
  };
}

type PluginAttachmentConfig = NonNullable<BosConfig["plugins"]>[string];

function sanitizePluginKey(value: string): string {
  return value
    .replace(/[^A-Za-z0-9/_-]/g, "-")
    .replace(/\/+/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, "-"))
    .join("/")
    .replace(/^\/+|\/+$/g, "");
}

function defaultPluginKey(source: string): string {
  const normalized = source.replace(/^local:/, "").replace(/\/$/, "");
  if (source.startsWith("local:")) {
    return sanitizePluginKey(basename(normalized)) || "plugin";
  }

  try {
    const url = new URL(source);
    return sanitizePluginKey(basename(url.pathname) || url.hostname) || "plugin";
  } catch {
    return sanitizePluginKey(source) || "plugin";
  }
}

function pluginLocalPath(configDir: string, attachment: PluginAttachmentConfig): string | null {
  const ref = getPluginRef(attachment);
  const source = ref?.development ?? ref?.production;
  if (!source?.startsWith("local:")) {
    return null;
  }

  return join(configDir, source.slice("local:".length));
}

function listPluginAttachments(config: BosConfig | null) {
  return (Object.entries(config?.plugins ?? {}) as Array<[string, PluginAttachmentConfig]>)
    .map(([key, attachment]) => {
      const ref = getPluginRef(attachment);
      return {
        key,
        development: ref?.development,
        production: ref?.production,
        localPath: ref?.development?.startsWith("local:")
          ? ref.development.slice("local:".length)
          : undefined,
        source: ref?.development?.startsWith("local:") ? ("local" as const) : ("remote" as const),
        integrity: ref?.integrity,
        version: ref?.version,
        name: ref?.name,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
