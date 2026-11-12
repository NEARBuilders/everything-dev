import { createConnection } from "node:net";
import { resolve } from "node:path";
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
  /** True when the target port accepted a TCP connection (so this is not a missing local server). */
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

/**
 * The one corruption preflight can catch without I/O: two or more
 * `*_DATABASE_URL` secrets resolving to the same file-backed PGlite data dir.
 * Multiple live PGlite instances share no coordination — they checkpoint
 * stale pages over each other's committed data (ADR 0044). In-memory dirs are
 * exempt (instances never share state), and a single occupant is fine. This
 * fires after the one-time repair (`env/legacy-databases`) has rewritten the
 * known-broken shape, so what remains is operator-authored — fail loudly
 * rather than boot a corrupting composition.
 */
function pgliteDirCollisions(env: Record<string, string>): PreflightFailure[] {
  const byDir = new Map<string, string[]>();
  for (const [secret, value] of Object.entries(env)) {
    if (!secret.endsWith("_DATABASE_URL") || !value?.startsWith("pglite:")) continue;
    const rawDir = value.slice("pglite:".length);
    if (rawDir === ":memory:" || rawDir.endsWith("/:memory:")) continue;
    const dir = resolve(rawDir);
    const secrets = byDir.get(dir);
    if (secrets) secrets.push(secret);
    else byDir.set(dir, [secret]);
  }

  const failures: PreflightFailure[] = [];
  for (const [dir, secrets] of byDir) {
    if (secrets.length < 2) continue;
    failures.push({
      secret: secrets.join(", "),
      host: dir,
      port: 0,
      error:
        `${secrets.join(" and ")} resolve to the same PGlite data dir "${dir}". Multiple live ` +
        "PGlite instances on one data dir silently corrupt committed data (ADR 0044) — give " +
        "each workspace its own data dir (pglite:.bos/db/<slug>) or point the extras at " +
        "postgres:// URLs.",
      tcpReachable: false,
    });
  }
  return failures;
}

export function preflightLocalInfra(
  env: Record<string, string>,
  overrides?: Record<string, string>,
): Effect.Effect<PreflightFailure[], never> {
  const merged = overrides ? { ...env, ...overrides } : env;
  const targets = preflightTargetsFromEnv(merged);
  const collisions = pgliteDirCollisions(merged);
  if (targets.length === 0) return Effect.succeed(collisions);

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
            ? " Point it at a postgres:// URL you control (local persistence needs no server — clear the URL to fall back to the per-workspace .bos/db/<slug> PGlite in development; production hosts refuse the unset default)."
            : ` The plugin for ${target.secret} runs inside the local host process, so this DB must be reachable. Point it at a postgres:// URL you control or clear the URL to fall back to the per-workspace .bos/db/<slug> PGlite.`;
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
  ).pipe(
    Effect.map((results) => [
      ...collisions,
      ...results.filter((r): r is PreflightFailure => r !== null),
    ]),
  );
}
