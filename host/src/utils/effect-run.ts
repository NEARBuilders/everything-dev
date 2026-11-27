import process from "node:process";
import {
  type EffectLogLevel,
  type LogLevelEnv,
  resolveLogLevel,
  toEffectLogLevel,
} from "everything-dev/dev-log-pipeline";

/** The host process's Effect log ceiling, from the shared CLI log-level flags
 * (`BOS_LOG_LEVEL` / `DEBUG`) — no new env vars. Effect-log debug marks in the
 * SSR seams stay silent unless this resolves to "Debug". */
export const minimumLogLevel = (): EffectLogLevel =>
  toEffectLogLevel(resolveLogLevel(process.env as LogLevelEnv));
