import type { PluginResult } from "../services/plugins";

const MB = 1048576;

export interface HealthLoadingState {
  status: string;
  startTime: number;
  milestones: string[];
  error: Error | null;
  ssrEnabled: boolean;
}

export interface MemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  rssMB: number;
  heapTotalMB: number;
  heapUsedMB: number;
  externalMB: number;
}

export function getMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rssMB: Math.round(mem.rss / MB),
    heapTotalMB: Math.round(mem.heapTotal / MB),
    heapUsedMB: Math.round(mem.heapUsed / MB),
    externalMB: Math.round(mem.external / MB),
  };
}

export function tryGc(): boolean {
  try {
    if (typeof Bun !== "undefined" && typeof (Bun as any).gc === "function") {
      (Bun as any).gc(true);
      return true;
    }
    if (typeof (globalThis as any).gc === "function") {
      (globalThis as any).gc();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function getPluginDetail(plugins: PluginResult) {
  const detail: Array<{ key: string; name: string; remoteUrl: string; version?: string }> = [];
  if (plugins.auth) {
    detail.push({
      key: "auth",
      name: plugins.auth.name,
      remoteUrl: plugins.auth.metadata.remoteUrl,
      ...(plugins.auth.metadata.version ? { version: plugins.auth.metadata.version } : {}),
    });
  }
  for (const [key, plugin] of Object.entries(plugins.plugins)) {
    detail.push({
      key,
      name: plugin.name,
      remoteUrl: plugin.metadata.remoteUrl,
      ...(plugin.metadata.version ? { version: plugin.metadata.version } : {}),
    });
  }
  return detail;
}

export function getHealthStatus(plugins: PluginResult, loadingState: HealthLoadingState) {
  const elapsed = Date.now() - loadingState.startTime;
  const status =
    loadingState.status === "failed"
      ? "failed"
      : plugins.api?.router && plugins.status.available
        ? "ready"
        : "degraded";
  return {
    status,
    ssr: loadingState.ssrEnabled ? (status === "ready" ? "available" : "unavailable") : "disabled",
    auth: plugins.auth
      ? { mounted: true, name: plugins.auth.name }
      : { mounted: false, name: null },
    plugins: {
      loaded: plugins.status.loadedPlugins,
      detail: getPluginDetail(plugins),
      ...(plugins.status.error ? { error: plugins.status.error } : {}),
    },
    memory: getMemorySnapshot(),
    uptime: elapsed,
    milestones: loadingState.milestones,
    ...(loadingState.error ? { error: loadingState.error.message } : {}),
  };
}

export const HEALTH_PATH = "/api/_health";
export const MEMORY_PATH = "/api/_memory";
