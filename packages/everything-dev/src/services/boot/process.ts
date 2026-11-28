import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Effect, Queue, Schema, Stream } from "effect";
import { stripAnsi } from "../dev/logs";
import { OrchestratorError, type ProcessHandle, type UnitEvent } from "./units";

const omitUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : omitUndefined(item)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)]),
    );
  }
  return value;
};

export const encodeRuntimeConfig = (runtimeConfig: unknown) =>
  Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))(omitUndefined(runtimeConfig)).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestratorError({
          operation: "serialize runtime config",
          detail: cause.message,
          cause,
        }),
    ),
  );

/**
 * Spawn env precedence, three tiers: values explicitly exported by the
 * caller (shell / CI / regression harness — captured by the bootstrap
 * program into the `ShellEnv` service before any `.env` loading) outrank the
 * generated infra env, which outranks `.env`-file values inherited through
 * `processEnv`. The service's resolved port is always authoritative.
 */
export function composeSpawnEnv(
  processEnv: Record<string, string>,
  generatedEnv: Record<string, string>,
  port: number,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...processEnv,
    ...mergeGeneratedOverFileEnv(generatedEnv, processEnv, shellEnv),
    FORCE_COLOR: "1",
    ...(port > 0 ? { PORT: String(port) } : {}),
  };
}

/**
 * Overlay the generated infra env (ports drift, so stale `.env` values must
 * lose) while keeping every explicitly exported key from `shellEnv` intact.
 * Keys absent from both are untouched.
 *
 * Exception (ADR 0012 / plan 038): the origin keys BASE_URL and CORS_ORIGIN
 * are always generated-owned — a wrapper that sourced a stale `.env` must not
 * win over the resolved host port, in the child env or on disk.
 */
const GENERATED_OWNED_KEYS = new Set(["BASE_URL", "CORS_ORIGIN"]);

export function mergeGeneratedOverFileEnv(
  generatedEnv: Record<string, string>,
  processEnv: Record<string, string>,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = { ...processEnv };
  for (const [key, value] of Object.entries(generatedEnv)) {
    if (!GENERATED_OWNED_KEYS.has(key) && key in shellEnv) {
      result[key] = shellEnv[key]!;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const spawnDevProcess = (input: {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly port: number;
  readonly generatedEnv: Record<string, string>;
  readonly shellTier: Record<string, string>;
  readonly runtimeConfigEnv: string;
}) =>
  Effect.gen(function* () {
    const fullCwd = input.cwd;
    const command = input.command;
    const args = input.args;
    const port = input.port;
    const name = input.name;

    // The descriptor's env joins the generated tier — folding it in before
    // composeSpawnEnv keeps the documented precedence (shell > generated >
    // .env-file); assigning after would let it outrank the shell tier (and
    // the generated-owned keys) silently.
    const envVars = composeSpawnEnv(
      process.env as Record<string, string>,
      { ...input.generatedEnv, ...input.env },
      port,
      input.shellTier,
    );

    envVars.BOS_RUNTIME_CONFIG = input.runtimeConfigEnv;

    const logQueue = yield* Queue.unbounded<UnitEvent>();
    let exited = false;
    let resolveExit: (() => void) | undefined;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const cmd = spawn(command, args, {
      cwd: fullCwd,
      env: envVars,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = cmd.pid ?? undefined;

    const offer = (event: UnitEvent) => {
      void Effect.runPromise(Queue.offer(logQueue, event).pipe(Effect.ignore));
    };

    const markExited = (code: number, signal?: string) => {
      if (exited) return;
      exited = true;
      offer({ type: "exited", code, signal: signal ?? undefined });
      resolveExit?.();
    };

    cmd.once("exit", (code, signal) => markExited(code ?? (signal ? 1 : 0), signal ?? undefined));
    cmd.once("error", (err) => {
      offer({ type: "log", line: `Spawn failed: ${err.message}`, stderr: true });
      markExited(1);
    });

    const handleLine = (line: string, isStderr: boolean) => {
      if (!line.trim()) return;
      const looksLikeError =
        isStderr &&
        /^(error|fail|fatal|exception|unhandled|reject)/i.test(stripAnsi(line)) &&
        !line.startsWith("$");
      offer({ type: "log", line, stderr: looksLikeError });
    };

    const wire = (source: Readable | null, isStderr: boolean) => {
      if (!source) return;
      const webStream = Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>;
      void Effect.runFork(
        Stream.runForEach((line: string) => Effect.sync(() => handleLine(line, isStderr)))(
          Stream.splitLines(
            Stream.decodeText(
              Stream.fromReadableStream({
                evaluate: () => webStream,
                onError: (cause) =>
                  new OrchestratorError({
                    operation: "read process output",
                    detail: String(cause),
                    cause,
                  }),
              }),
            ),
          ),
        ),
      );
    };
    wire(cmd.stdout, false);
    wire(cmd.stderr, true);

    const terminate = (mode: "graceful" | "force") =>
      Effect.gen(function* () {
        const groupSignal = (signal: NodeJS.Signals) =>
          Effect.try(() => {
            if (pid !== undefined) process.kill(-pid, signal);
          }).pipe(Effect.ignore);
        if (mode === "force") {
          yield* groupSignal("SIGKILL");
          yield* Effect.sleep("250 millis");
          return;
        }
        yield* groupSignal("SIGTERM");
        yield* Effect.promise(() =>
          Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]),
        );
        if (!exited) {
          yield* groupSignal("SIGKILL");
          yield* Effect.sleep("250 millis");
        }
      }).pipe(Effect.ignore);

    return {
      name,
      pid,
      events: Stream.fromQueue(logQueue),
      terminate,
    } satisfies ProcessHandle;
  });
