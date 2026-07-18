import { Context, Layer } from "effect";
import type { JsonObject, RuntimeConfig, SourceMode } from "./types";

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
  readyPatterns?: RegExp[];
  errorPatterns?: RegExp[];
}

export class ServiceDescriptorMap extends Context.Tag("ServiceDescriptorMap")<
  ServiceDescriptorMap,
  Map<string, ServiceDescriptor>
>() {}

export class DevRuntimeConfig extends Context.Tag("DevRuntimeConfig")<
  DevRuntimeConfig,
  RuntimeConfig
>() {}

const PLUGIN_READY_PATTERNS = [/ready in/i, /compiled.*successfully/i, /listening/i, /started/i];

const PLUGIN_ERROR_PATTERNS = [/error/i, /failed/i];

const SERVICE_CONFIGS: Record<
  string,
  Pick<
    ServiceDescriptor,
    "command" | "args" | "readyPatterns" | "errorPatterns" | "defaultPort" | "readinessPath"
  >
> = {
  host: {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: [/Host (dev|production) server running at/i, /Server running at/i],
    errorPatterns: [/error:/i, /failed/i, /exception/i],
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
    errorPatterns: [/error/i, /failed to compile/i],
    defaultPort: 3003,
    readinessPath: "/remoteEntry.js",
  },
  "ui-ssr": {
    command: "bun",
    args: ["run", "dev:ssr"],
    readyPatterns: [/\bready\s+built in\b/i, /\bcompiled\b.*successfully/i],
    errorPatterns: [/error/i, /failed/i],
    defaultPort: 3004,
    readinessPath: "/",
  },
  api: {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: PLUGIN_READY_PATTERNS,
    errorPatterns: PLUGIN_ERROR_PATTERNS,
    defaultPort: 3001,
    readinessPath: "/remoteEntry.js",
  },
};

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
  });

  if (ssr && runtimeConfig.ui.source === "local") {
    map.set("ui-ssr", {
      key: "ui-ssr",
      source: runtimeConfig.ui.source,
      url: runtimeConfig.ui.ssrUrl ?? "",
      entry: "",
      name: "ui-ssr",
      localPath: runtimeConfig.ui.localPath,
      port: runtimeConfig.ui.ssrUrl
        ? Number.parseInt(new URL(runtimeConfig.ui.ssrUrl).port, 10)
        : (runtimeConfig.ui.port ?? 3003) + 1,
      ...SERVICE_CONFIGS["ui-ssr"],
    });
  }

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
      const pluginKey = `plugin:${pluginId}`;
      const resolvedPort = pluginConfig.port ?? pluginBasePort;
      pluginBasePort = resolvedPort + 1;

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
        readyPatterns: PLUGIN_READY_PATTERNS,
        errorPatterns: PLUGIN_ERROR_PATTERNS,
        defaultPort: resolvedPort,
        readinessPath: "/remoteEntry.js",
      });

      if (pluginConfig.ui?.localPath && pluginConfig.ui.source === "local") {
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

export function buildDescription(map: Map<string, ServiceDescriptor>): string {
  const descriptors = [...map.values()].filter(
    (d) => d.key !== "ui-ssr" && !d.key.startsWith("plugin:"),
  );

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
