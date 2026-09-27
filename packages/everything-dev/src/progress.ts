import { EventEmitter } from "node:events";
import type { PhaseTiming } from "./contract";

export type ProgressEvent = {
  phase: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  message?: string;
};

export const pluginEvents = new EventEmitter();

export async function timePhase<T>(
  timings: PhaseTiming[],
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  pluginEvents.emit("progress", {
    phase: name,
    status: "running",
  } satisfies ProgressEvent);
  const startedAt = Date.now();
  try {
    const result = await fn();
    timings.push({ name, durationMs: Date.now() - startedAt });
    pluginEvents.emit("progress", {
      phase: name,
      status: "done",
      durationMs: Date.now() - startedAt,
    } satisfies ProgressEvent);
    return result;
  } catch (error) {
    pluginEvents.emit("progress", {
      phase: name,
      status: "error",
      durationMs: Date.now() - startedAt,
    } satisfies ProgressEvent);
    throw error;
  }
}
