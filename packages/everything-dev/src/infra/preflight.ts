import { createConnection } from "node:net";
import { Effect } from "effect";

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
}

function parseLocalUrl(url: string): { host: string; port: number } | null {
  try {
    const match = url.match(/:\/\/([^:/]+):(\d+)/);
    if (!match) return null;
    const host = match[1];
    const port = Number.parseInt(match[2], 10);
    if (Number.isNaN(port)) return null;
    if (host !== "localhost" && host !== "127.0.0.1") return null;
    return { host, port };
  } catch {
    return null;
  }
}

function checkTcpReachable(host: string, port: number, timeoutMs = 2000): Effect.Effect<boolean> {
  return Effect.async<boolean>((resume) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resume(Effect.succeed(false));
    }, timeoutMs);

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

    try {
      const { Pool } = yield* Effect.promise(() => import("pg"));
      const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
      const client = yield* Effect.promise(() => pool.connect().then((c) => ({ client: c, pool })));
      try {
        yield* Effect.promise(() => client.client.query("SELECT 1"));
        return true;
      } finally {
        client.client.release();
        yield* Effect.promise(() => client.pool.end().catch(() => {}));
      }
    } catch {
      return false;
    }
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
          const pluginContext = target.secret.endsWith("_DATABASE_URL")
            ? ` The plugin for ${target.secret} runs inside the local host process, so this DB must be reachable. Run \`docker compose up -d --wait\` to start local Postgres/Redis.`
            : "";
          if (tcpOk) {
            return {
              secret: target.secret,
              host: target.host,
              port: target.port,
              error: `${target.secret} at ${target.host}:${target.port} is reachable but Postgres connection failed. Check credentials and database name.${pluginContext}`,
            } satisfies PreflightFailure;
          }
          return {
            secret: target.secret,
            host: target.host,
            port: target.port,
            error: `${target.secret} points to ${target.host}:${target.port} but nothing is listening.${pluginContext}`,
          } satisfies PreflightFailure;
        }

        const reachable = yield* checkTcpReachable(target.host, target.port);
        if (reachable) return null;
        return {
          secret: target.secret,
          host: target.host,
          port: target.port,
          error: `${target.secret} points to ${target.host}:${target.port} but nothing is listening`,
        } satisfies PreflightFailure;
      }),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((results) => results.filter((r): r is PreflightFailure => r !== null)));
}
