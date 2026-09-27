import { existsSync } from "node:fs";
import path from "node:path";
import { Context, Layer } from "effect";
import type { JsonObject, RuntimeConfig, SourceMode } from "./types";

export interface AuthSlotShape {
  source: string;
  localPath?: string;
  url?: string;
}

/**
 * True when a `plugins.<id>` entry is the runtime-config mirror of the
 * app-slot auth plugin (same backend target) — the `auth` service already
 * spawns that backend, so the mirror contributes only its `ui` surface.
 * The single implementation; consumed by the service descriptors, the DAG,
 * the infra planner, and the dev session.
 */
export function isAuthMirrorPluginEntry(
  authEntry: AuthSlotShape | undefined,
  pluginId: string,
  pluginConfig: AuthSlotShape,
): boolean {
  if (pluginId !== "auth" || !authEntry) return false;
  if (pluginConfig === authEntry) return true;
  if (pluginConfig.localPath && pluginConfig.localPath === authEntry.localPath) return true;
  if (
    !pluginConfig.localPath &&
    pluginConfig.source === "remote" &&
    pluginConfig.url &&
    pluginConfig.url === authEntry.url
  ) {
    return true;
  }
  return false;
}

export interface ServiceDescriptor {
  key: string;
  source: SourceMode;
  url: string;
  remoteUrl?: string;
  entry: string;
  name: string;
  localPath?: string;
  port?: number;
  readinessPath: string;
  defaultPort: number;
  integrity?: string;
  proxy?: string;
  variables?: JsonObject;
  secrets?: string[];
  ssr?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  readyPatterns?: RegExp[];
  errorPatterns?: RegExp[];
  /** folder-form plugin UI port — the UI build is a child of this dev process (BOS_UI_PORT) */
  uiPort?: number;
}

export class ServiceDescriptorMap extends Context.Service<
  ServiceDescriptorMap,
  Map<string, ServiceDescriptor>
>()("ServiceDescriptorMap") {}

export class DevRuntimeConfig extends Context.Service<DevRuntimeConfig, RuntimeConfig>()(
  "DevRuntimeConfig",
) {}

export class DevGeneratedEnv extends Context.Service<DevGeneratedEnv, Record<string, string>>()(
  "DevGeneratedEnv",
) {}

export const DevGeneratedEnvLive = (env: Record<string, string>) =>
  Layer.succeed(DevGeneratedEnv, env);

const PLUGIN_READY_PATTERNS = [/ready in/i, /compiled.*successfully/i, /listening/i, /started/i];

const PLUGIN_ERROR_PATTERNS = [
  /\bERROR in\b/,
  /failed to compile/i,
  /Module not found/i,
  /Cannot find module/i,
];

const SERVICE_CONFIGS = {
  host: {
    command: "bun",
    args: ["run", "dev"],
    // The host dev server runs on tsx (TS-capable node), so it can consume
    // framework package sources directly — NODE_OPTIONS makes node's
    // resolver pick the `development` export condition. bun's --conditions
    // flag (added in orchestrator.spawnDevProcess) does not reach this node
    // child, so the env var is the seam here. rsbuild/rspack config loaders
    // must NOT receive it: their .mjs config evaluation is not TS-capable.
    env: { NODE_OPTIONS: "--conditions=development" },
    readyPatterns: [/Host (dev|production) server running at/i, /Server running at/i],
    errorPatterns: [/\berror\b(?!s)/i, /\bfailed to\b/i, /\bbuild failed\b/i, /exception/i],
    defaultPort: 3000,
    readinessPath: "/health",
  },
  auth: {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: PLUGIN_READY_PATTERNS,
    errorPatterns: PLUGIN_ERROR_PATTERNS,
    defaultPort: 3002,
    readinessPath: "/remoteEntry.js",
  },
  ui: {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: [/\bready\s+built in\b/i, /\bLocal:\b/i, /\bcompiled\b.*successfully/i],
    errorPatterns: [/\berror\b(?!s)/i, /\bfailed to\b/i, /\bbuild failed\b/i],
    defaultPort: 3003,
    readinessPath: "/remoteEntry.js",
  },
  api: {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: PLUGIN_READY_PATTERNS,
    errorPatterns: PLUGIN_ERROR_PATTERNS,
    defaultPort: 3001,
    readinessPath: "/remoteEntry.js",
  },
} as const satisfies Record<
  string,
  Pick<
    ServiceDescriptor,
    "command" | "args" | "env" | "readyPatterns" | "errorPatterns" | "defaultPort" | "readinessPath"
  >
>;

export function buildServiceDescriptorMap(
  runtimeConfig: RuntimeConfig,
  options?: { ssr?: boolean; proxy?: boolean },
): Map<string, ServiceDescriptor> {
  const map = new Map<string, ServiceDescriptor>();
  const ssr = options?.ssr ?? false;

  const hostIsRemote = runtimeConfig.host.source === "remote";
  const hostProbeUrl = hostIsRemote
    ? (runtimeConfig.host.remoteUrl ?? runtimeConfig.host.url)
    : runtimeConfig.host.url;
  map.set("host", {
    key: "host",
    source: runtimeConfig.host.source,
    url: hostProbeUrl,
    remoteUrl: runtimeConfig.host.remoteUrl,
    entry: hostIsRemote
      ? hostProbeUrl
        ? `${hostProbeUrl}/mf-manifest.json`
        : "/mf-manifest.json"
      : runtimeConfig.host.entry,
    name: runtimeConfig.host.name,
    localPath: runtimeConfig.host.localPath,
    port: runtimeConfig.host.port,
    integrity: runtimeConfig.host.integrity,
    secrets: runtimeConfig.host.secrets,
    ...SERVICE_CONFIGS.host,
  });

  map.set("ui", {
    key: "ui",
    source: runtimeConfig.ui.source,
    url: runtimeConfig.ui.url,
    remoteUrl: runtimeConfig.ui.source === "remote" ? runtimeConfig.ui.url : undefined,
    entry: runtimeConfig.ui.entry,
    name: runtimeConfig.ui.name,
    localPath: runtimeConfig.ui.localPath,
    port: runtimeConfig.ui.port,
    integrity: runtimeConfig.ui.integrity,
    ssr,
    ...SERVICE_CONFIGS.ui,
    // BOS_NO_WATCH stacks (regression/CI) build once and serve the built dist
    // via rsbuild preview — no watcher, no HMR.
    args: process.env.BOS_NO_WATCH === "1" ? ["run", "dev:built"] : SERVICE_CONFIGS.ui.args,
  });

  map.set("api", {
    key: "api",
    source: runtimeConfig.api.source,
    url: runtimeConfig.api.url,
    remoteUrl: runtimeConfig.api.source === "remote" ? runtimeConfig.api.url : undefined,
    entry: runtimeConfig.api.entry,
    name: runtimeConfig.api.name,
    localPath: runtimeConfig.api.localPath,
    port: runtimeConfig.api.port,
    integrity: runtimeConfig.api.integrity,
    proxy: runtimeConfig.api.proxy,
    variables: runtimeConfig.api.variables,
    secrets: runtimeConfig.api.secrets,
    ...SERVICE_CONFIGS.api,
  });

  if (runtimeConfig.auth) {
    map.set("auth", {
      key: "auth",
      source: runtimeConfig.auth.source,
      url: runtimeConfig.auth.url,
      remoteUrl: runtimeConfig.auth.source === "remote" ? runtimeConfig.auth.url : undefined,
      entry: runtimeConfig.auth.entry,
      name: runtimeConfig.auth.name,
      localPath: runtimeConfig.auth.localPath,
      port: runtimeConfig.auth.port,
      integrity: runtimeConfig.auth.integrity,
      proxy: runtimeConfig.auth.proxy,
      variables: runtimeConfig.auth.variables,
      secrets: runtimeConfig.auth.secrets,
      ...SERVICE_CONFIGS.auth,
    });
  }

  if (runtimeConfig.plugins) {
    let pluginBasePort = 3010;
    for (const [pluginId, pluginConfig] of Object.entries(runtimeConfig.plugins)) {
      const isAuthMirror = isAuthMirrorPluginEntry(runtimeConfig.auth, pluginId, pluginConfig);
      const pluginKey = `plugin:${pluginId}`;
      const resolvedPort = pluginConfig.port ?? pluginBasePort;
      pluginBasePort = resolvedPort + 1;

      // Folder-form ui source: the ui dir lives inside the plugin workspace
      // (no own package.json) — `every-plugin dev` spawns its UI build as a
      // child (BOS_UI_PORT), so no separate plugin-ui service is spawned.
      const uiLocalPath = pluginConfig.ui?.localPath;
      const isFolderFormUi = Boolean(
        uiLocalPath &&
          pluginConfig.ui?.source === "local" &&
          existsSync(path.join(uiLocalPath, "src", "routes")) &&
          !existsSync(path.join(uiLocalPath, "package.json")),
      );
      const folderUiPort = pluginConfig.ui?.port ?? pluginBasePort;
      if (isFolderFormUi) pluginBasePort = folderUiPort + 1;

      if (!isAuthMirror) {
        map.set(pluginKey, {
          key: pluginKey,
          source: pluginConfig.source,
          url: pluginConfig.url,
          remoteUrl: pluginConfig.source === "remote" ? pluginConfig.url : undefined,
          entry: pluginConfig.entry,
          name: pluginConfig.name,
          localPath: pluginConfig.localPath,
          port: resolvedPort,
          integrity: pluginConfig.integrity,
          proxy: pluginConfig.proxy,
          variables: pluginConfig.variables,
          secrets: pluginConfig.secrets,
          command: "bun",
          args: ["run", "dev"],
          env: isFolderFormUi ? { BOS_UI_PORT: String(folderUiPort) } : undefined,
          uiPort: isFolderFormUi ? folderUiPort : undefined,
          readyPatterns: PLUGIN_READY_PATTERNS,
          errorPatterns: PLUGIN_ERROR_PATTERNS,
          defaultPort: resolvedPort,
          readinessPath: "/remoteEntry.js",
        });
      } else if (isFolderFormUi) {
        // Folder-form ui for the auth mirror: the `auth` app slot owns the
        // dev process (plugin:auth is not spawned), so BOS_UI_PORT rides on
        // the auth descriptor. folderUiPort is the same port the runtime
        // config wired into the mirror's ui.url (withLocalRuntimeUrl).
        const authDescriptor = map.get("auth");
        if (authDescriptor) {
          map.set("auth", {
            ...authDescriptor,
            env: { BOS_UI_PORT: String(folderUiPort) },
            uiPort: folderUiPort,
          });
        }
      }

      if (pluginConfig.ui?.localPath && pluginConfig.ui.source === "local" && !isFolderFormUi) {
        const uiKey = `plugin-ui:${pluginId}`;
        const uiPort = pluginConfig.ui.port ?? pluginBasePort;
        pluginBasePort = uiPort + 1;

        map.set(uiKey, {
          key: uiKey,
          source: pluginConfig.ui.source,
          url: pluginConfig.ui.url,
          entry: pluginConfig.ui.entry,
          name: pluginConfig.ui.name,
          localPath: pluginConfig.ui.localPath,
          port: uiPort,
          integrity: pluginConfig.ui.integrity,
          command: "bun",
          args: ["run", "dev"],
          readyPatterns: PLUGIN_READY_PATTERNS,
          errorPatterns: PLUGIN_ERROR_PATTERNS,
          defaultPort: uiPort,
          readinessPath: "/remoteEntry.js",
        });
      }
    }
  }

  return map;
}

export interface AppOrchestrator {
  packages: string[];
  description: string;
  env: Record<string, string>;
  port?: number;
  interactive?: boolean;
  noLogs?: boolean;
}

export const ServiceDescriptorMapLive = (map: Map<string, ServiceDescriptor>) =>
  Layer.succeed(ServiceDescriptorMap, map);

export const DevRuntimeConfigLive = (config: RuntimeConfig) =>
  Layer.succeed(DevRuntimeConfig, config);

export function buildServiceDescriptorMapFromPlan(
  plan: {
    runtimeConfig: RuntimeConfig;
    resolvedPorts: { host?: number; api?: number; auth?: number; ui?: number; uiSsr?: number };
  },
  options?: { ssr?: boolean; proxy?: boolean },
): Map<string, ServiceDescriptor> {
  return buildServiceDescriptorMap(plan.runtimeConfig, options);
}

interface ServiceDescriptorInfo {
  key: string;
  source: string;
  proxy?: string;
}

export function buildDescription(map: Map<string, ServiceDescriptorInfo>): string {
  const descriptors = [...map.values()].filter((d) => !d.key.startsWith("plugin:"));

  const allLocal = descriptors.every((d) => d.source === "local");
  const hasProxy = [...map.values()].some((d) => d.proxy && d.source === "local");
  if (allLocal && !hasProxy) return "Full Local Development";

  const parts: string[] = [];
  for (const d of descriptors) {
    if (d.source === "remote") {
      const label =
        d.key === "host"
          ? "Remote Host"
          : d.key === "ui"
            ? "Remote UI"
            : d.key === "api"
              ? hasProxy
                ? undefined
                : "Remote API"
              : d.key === "auth"
                ? "Remote Auth"
                : undefined;
      if (label) parts.push(label);
    }
  }
  if (hasProxy) parts.push("Proxy API → Production");
  return parts.join(" + ") || "Remote Mode";
}
