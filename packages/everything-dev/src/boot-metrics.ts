import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PhaseTiming } from "./contract";
import { stripAnsi } from "./services/dev/logs";
import type { ServiceDescriptor } from "./services/dev/service-descriptor";

export interface BootServiceTiming {
  name: string;
  source?: "local" | "remote";
  startingMs: number;
  readyMs?: number;
  status: "ready" | "error";
  message?: string;
}

export interface BootMetrics {
  mode: "dev" | "start";
  startedAt: string;
  ssr: boolean;
  totalToReadyMs: number;
  phases: PhaseTiming[];
  services: BootServiceTiming[];
}

export interface BootMetricsCollector {
  recordStatus: (name: string, status: string, message?: string) => void;
  write: () => void;
}

/**
 * Collector for `.bos/boot-metrics.json`: orchestrator `onStatus` transitions
 * per service (spawn→ready ms, relative to session start) plus the CLI bootstrap
 * phases (timedPhase — measured in the CLI process before the session begins).
 * Flushed once at session-ready, machine-readable for the regression harness.
 */
export function createBootMetricsCollector(options: {
  configDir: string;
  mode: "dev" | "start";
  services: Map<string, ServiceDescriptor>;
  phases: PhaseTiming[];
}): BootMetricsCollector {
  const startedMs = Date.now();
  const byName = new Map<string, BootServiceTiming>();

  return {
    recordStatus: (name, status, message?) => {
      const nowMs = Date.now() - startedMs;
      let entry = byName.get(name);
      if (!entry) {
        const descriptor = options.services.get(name);
        entry = {
          name,
          source: descriptor?.source,
          startingMs: nowMs,
          status: "ready",
        };
        byName.set(name, entry);
      }
      if (status === "ready") {
        entry.readyMs = entry.readyMs ?? nowMs;
        entry.status = "ready";
        entry.message = message ?? entry.message;
        return;
      }
      if (status === "error") {
        entry.readyMs = entry.readyMs ?? nowMs;
        entry.status = "error";
        entry.message = message ? stripAnsi(message) : entry.message;
      }
    },

    write: () => {
      try {
        const metrics: BootMetrics = {
          mode: options.mode,
          startedAt: new Date(startedMs).toISOString(),
          ssr: process.env.BOS_SSR === "1",
          totalToReadyMs: Date.now() - startedMs,
          phases: options.phases.map((phase) => ({ ...phase })),
          services: [...byName.values()].map((entry) => ({ ...entry })),
        };
        const filePath = path.join(options.configDir, ".bos", "boot-metrics.json");
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, `${JSON.stringify(metrics, null, 2)}\n`);
      } catch {
        // best-effort; metrics are observability, never boot-blocking
      }
    },
  };
}
