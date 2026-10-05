import { createConnection } from "node:net";
import { Data, Effect } from "effect";

class PreflightConnectionError extends Data.TaggedError("PreflightConnectionError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return `Postgres connection failed: ${
      this.cause instanceof Error ? this.cause.message : String(this.cause)
    }`;
  }
}

const scheduleTimeout = (ms: number, fn: () => void): ReturnType<typeof setTimeout> =>
  setTimeout(fn, ms);

export interface PreflightTarget {
  secret: string;
  host: string;
  port: number;
  kind: "postgres" | "redis";
  url: string;
}

export interface PreflightFailure {
  secret: string;
  host: string;
  port: number;
  error: string;
  /** True when the target port accepted a TCP connection (so docker compose cannot fix this failure). */
  tcpReachable: boolean;
}

function parseLocalUrl(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return null;
    const port = Number.parseInt(parsed.port, 10);
    if (Number.isNaN(port)) {
      const fallback = parsed.protocol === "redis:" ? 6379 : 5432;
      return { host, port: fallback };
    }
    return { host, port };
  } catch {
    return null;
  }
}

function checkTcpReachable(host: string, port: number, timeoutMs = 2000): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    const socket = createConnection({ host, port });
    const timer = scheduleTimeout(timeoutMs, () => {
      socket.destroy();
      resume(Effect.succeed(false));
    });

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resume(Effect.succeed(true));
    });

    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resume(Effect.succeed(false));
    });
  });
}

function checkPgConnection(url: string): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const reachable = yield* checkTcpReachable(
      new URL(url).hostname,
      Number(new URL(url).port) || 5432,
      4000,
    );
    if (!reachable) return false;

    return yield* Effect.tryPromise({
      try: async () => {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
        try {
          const client = await pool.connect();
          try {
            await client.query("SELECT 1");
            return true;
          } finally {
            client.release();
          }
        } finally {
          await pool.end().catch(() => {});
        }
      },
      catch: (cause) => new PreflightConnectionError({ cause }),
    }).pipe(Effect.orElseSucceed(() => false));
  });
}

function preflightTargetsFromEnv(env: Record<string, string>): PreflightTarget[] {
  const targets: PreflightTarget[] = [];
  for (const [secret, value] of Object.entries(env)) {
    if (!value) continue;
    if (secret.endsWith("_DATABASE_URL")) {
      const parsed = parseLocalUrl(value);
      if (parsed) {
        targets.push({
          secret,
          host: parsed.host,
          port: parsed.port,
          kind: "postgres",
          url: value,
        });
      }
    } else if (secret.endsWith("_REDIS_URL")) {
      const parsed = parseLocalUrl(value);
      if (parsed) {
        targets.push({ secret, host: parsed.host, port: parsed.port, kind: "redis", url: value });
      }
    }
  }
  return targets;
}

export function preflightLocalInfra(
  env: Record<string, string>,
  overrides?: Record<string, string>,
): Effect.Effect<PreflightFailure[], never> {
  const merged = overrides ? { ...env, ...overrides } : env;
  const targets = preflightTargetsFromEnv(merged);
  if (targets.length === 0) return Effect.succeed([]);

  return Effect.forEach(
    targets,
    (target) =>
      Effect.gen(function* () {
        if (target.kind === "postgres") {
          const ok = yield* checkPgConnection(target.url);
          if (ok) return null;
          const tcpOk = yield* checkTcpReachable(target.host, target.port);
          const appDb =
            target.secret === "API_DATABASE_URL" || target.secret === "AUTH_DATABASE_URL";
          const pluginContext = appDb
            ? " Run `docker compose up -d --wait` to start local Postgres."
            : ` The plugin for ${target.secret} runs inside the local host process, so this DB must be reachable. Run \`docker compose up -d --wait\` to start local Postgres.`;
          if (tcpOk) {
            return {
              secret: target.secret,
              host: target.host,
              port: target.port,
              error: `${target.secret} at ${target.host}:${target.port} is reachable but Postgres connection failed. Check credentials and database name.${pluginContext}`,
              tcpReachable: true,
            } satisfies PreflightFailure;
          }
          return {
            secret: target.secret,
            host: target.host,
            port: target.port,
            error: `${target.secret} points to ${target.host}:${target.port} but nothing is listening.${pluginContext}`,
            tcpReachable: false,
          } satisfies PreflightFailure;
        }

        const reachable = yield* checkTcpReachable(target.host, target.port);
        if (reachable) return null;
        return {
          secret: target.secret,
          host: target.host,
          port: target.port,
          error: `${target.secret} points to ${target.host}:${target.port} but nothing is listening`,
          tcpReachable: false,
        } satisfies PreflightFailure;
      }),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((results) => results.filter((r): r is PreflightFailure => r !== null)));
}
