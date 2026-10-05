import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const DEFAULT_BASE_URL = "http://localhost:4100";
const DEFAULT_PG_USER = "everythingdev";
const DEFAULT_PG_PASSWORD = "everythingdev";
const DEFAULT_BETTER_AUTH_SECRET = "regression-test-secret-do-not-use-in-production";

export function findRepoRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  for (;;) {
    // Authored descriptor (ADR 0005) or the legacy generated JSON.
    if (fs.existsSync(path.join(current, "bos.app.ts"))) return current;
    if (fs.existsSync(path.join(current, "bos.config.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readGeneratedConfig(repoRoot) {
  const generatedPath = path.join(repoRoot, ".bos", "bos.resolved-config.json");
  if (!fs.existsSync(generatedPath)) return null;
  return JSON.parse(fs.readFileSync(generatedPath, "utf-8"));
}

/**
 * Resolved-config loader for regression helpers (ADR 0005): the generated
 * file under `.bos/` is the publish input, the committed root JSON is the
 * legacy fallback, and checkouts that never ran a bos command get the
 * generated file written by the CLI resolution on demand.
 */
export function loadRegressionConfig(repoRoot) {
  const generated = readGeneratedConfig(repoRoot);
  if (generated) return generated;
  if (fs.existsSync(path.join(repoRoot, "bos.config.json"))) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, "bos.config.json"), "utf-8"));
  }

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "--conditions=development",
      path.join(repoRoot, "tests/regression/lib/resolve-config.mjs"),
    ],
    { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve the authored config (resolve-config exited ${result.status}):\n${result.stderr ?? result.stdout ?? ""}`,
    );
  }
  const resolved = readGeneratedConfig(repoRoot);
  if (!resolved) {
    throw new Error("bos types gen succeeded but .bos/bos.resolved-config.json was not written");
  }
  return resolved;
}

export function readDotEnv(repoRoot, fileName = ".env") {
  const envPath = path.join(repoRoot, fileName);
  if (!fs.existsSync(envPath)) return {};
  return parse(fs.readFileSync(envPath));
}

function databaseSecrets(config) {
  const sections = [
    config.app?.api?.secrets,
    config.app?.auth?.secrets,
    ...Object.values(config.plugins ?? {}).map((plugin) => plugin?.secrets),
  ];
  const seen = new Set();
  const secrets = [];
  for (const list of sections) {
    for (const secret of list ?? []) {
      if (typeof secret === "string" && secret.endsWith("_DATABASE_URL") && !seen.has(secret)) {
        seen.add(secret);
        secrets.push(secret);
      }
    }
  }
  return secrets;
}
function defaultDevDatabaseUrl(secret, pgUser, pgPassword, pgHost) {
  const isAuth = secret === "AUTH_DATABASE_URL";
  const port = isAuth ? 5433 : 5432;
  const databaseName = isAuth ? "auth_db" : "api_db";
  return `postgres://${pgUser}:${pgPassword}@${pgHost}:${port}/${databaseName}`;
}

export function computeRegressionEnv({ repoRoot, env = process.env } = {}) {
  const root = repoRoot ?? findRepoRoot();
  if (!root) throw new Error("No authored config (bos.app.ts) found in any parent directory");
  const config = loadRegressionConfig(root);
  const fileEnv = readDotEnv(root);
  const testEnv = readDotEnv(root, ".env.test");
  const allowDevDb = env.REGRESSION_ALLOW_DEV_DB === "1";

  const pgUser = env.REGRESSION_PG_USER ?? fileEnv.REGRESSION_PG_USER ?? DEFAULT_PG_USER;
  const pgPassword =
    env.REGRESSION_PG_PASSWORD ?? fileEnv.REGRESSION_PG_PASSWORD ?? DEFAULT_PG_PASSWORD;
  const pgHost = env.REGRESSION_PG_HOST ?? fileEnv.REGRESSION_PG_HOST ?? "127.0.0.1";

  const dbUrls = {};
  for (const secret of databaseSecrets(config)) {
    const devUrl = fileEnv[secret] ?? defaultDevDatabaseUrl(secret, pgUser, pgPassword, pgHost);
    const resolved = testEnv[secret] ?? env[secret] ?? fileEnv[secret] ?? devUrl;
    if (!allowDevDb && resolved === devUrl) {
      throw new Error(
        `refusing to run: ${secret} resolves to the dev database. ` +
          "Regression tests must stay isolated from dev databases. " +
          "Restore the generated .env.test (run `pnpm run bos dev` to regenerate), " +
          "or start the test databases with `pnpm run test:db:up`, " +
          "or set REGRESSION_ALLOW_DEV_DB=1 to override deliberately.",
      );
    }
    dbUrls[secret] = resolved;
  }

  const baseUrl = env.REGRESSION_BASE_URL ?? fileEnv.REGRESSION_BASE_URL ?? DEFAULT_BASE_URL;
  const devAuthSecret = fileEnv.BETTER_AUTH_SECRET || null;
  const authSecret =
    testEnv.BETTER_AUTH_SECRET ??
    env.BETTER_AUTH_SECRET ??
    fileEnv.BETTER_AUTH_SECRET ??
    DEFAULT_BETTER_AUTH_SECRET;
  if (!allowDevDb && devAuthSecret && authSecret === devAuthSecret) {
    throw new Error(
      "refusing to run: BETTER_AUTH_SECRET matches the dev .env secret. " +
        "Restore the generated .env.test with the test secret, " +
        "or set REGRESSION_ALLOW_DEV_DB=1 to override deliberately.",
    );
  }
  const parsedBase = new URL(baseUrl);
  const basePort = Number(parsedBase.port) || (parsedBase.protocol === "https:" ? 443 : 80);
  const localPluginCount = Object.values(config.plugins ?? {}).filter(
    (plugin) => typeof plugin?.development === "string" && plugin.development.startsWith("local:"),
  ).length;
  const stalePorts = [0, 1, 2, 3, 4].map((offset) => basePort + offset);
  for (let i = 0; i < localPluginCount * 2; i++) {
    stalePorts.push(basePort + 10 + i);
  }

  return { repoRoot: root, baseUrl, basePort, dbUrls, authSecret, stalePorts };
}

export function regressionStackOptions(config, mode, env = process.env) {
  // start:* stacks boot through the deployment image (`regression:start:*`
  // scripts → start-container.mjs) — they don't resolve a runner-side command.
  if (!["dev:ssr", "dev:csr", "backcompat"].includes(mode)) {
    throw new Error(
      `unknown mode: ${mode} (expected dev:ssr | dev:csr | backcompat — start stacks boot via start-container)`,
    );
  }
  const { basePort } = config;
  // node + tsx runs the CLI from source (bun's native TS execution is retired
  // — ADR 0026); the development condition keeps framework packages resolving
  // src over a possibly stale dist (ADR 0018).
  const tsFromSource = ["--import", "tsx", "--conditions=development"];
  const command =
    mode === "backcompat"
      ? [
          ...tsFromSource,
          "packages/everything-dev/src/cli.ts",
          "dev",
          "--no-interactive",
          "--host",
          "local",
          "--ui",
          "remote",
          "--api",
          "remote",
          "--auth",
          "local",
          "--remote-plugins",
          "apps,template",
          "--port",
          String(basePort),
          "--api-port",
          String(basePort + 1),
          "--auth-port",
          String(basePort + 2),
          "--ui-port",
          String(basePort + 3),
          "--plugin-port-start",
          String(basePort + 10),
        ]
      : [
          ...tsFromSource,
          "packages/everything-dev/src/cli.ts",
          "dev",
          "--no-interactive",
          // `dev:ssr` exercises source-composed SSR; `dev:csr` boots the
          // default no-SSR stack so the client-side compose path is
          // covered too.
          ...(mode === "dev:ssr" ? ["--ssr"] : []),
          "--port",
          String(basePort),
          "--api-port",
          String(basePort + 1),
          "--auth-port",
          String(basePort + 2),
          "--ui-port",
          String(basePort + 3),
          "--plugin-port-start",
          String(basePort + 10),
        ];
  return {
    command,
    env: {
      ...env,
      ...config.dbUrls,
      BETTER_AUTH_SECRET: config.authSecret,
      ...(mode === "dev:ssr" || mode === "backcompat" ? { BETTER_AUTH_URL: config.baseUrl } : {}),
      // The auth plugin's dev config derives its Better Auth baseURL from
      // BASE_URL — without it the instance falls back to localhost:3000 and
      // every baseURL-derived URL (invite links, passkey RP id) is wrong
      // whenever the stack runs on a non-3000 host port.
      BASE_URL: config.baseUrl,
      // No watchers in regression stacks: each service builds once and serves
      // the built output — watchers are the heaviest processes in the stack
      // and stall shared CI runners under their accumulated footprint.
      BOS_NO_WATCH: "1",
      BOS_NO_PERSIST_PORTS: "1",
      CORS_ORIGIN: env.CORS_ORIGIN ?? config.baseUrl,
    },
  };
}

const thisFile = fileURLToPath(import.meta.url);
const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === thisFile;

if (isDirectRun) {
  try {
    const result = computeRegressionEnv();
    if (process.argv.includes("--json")) {
      console.log(
        JSON.stringify(
          {
            baseUrl: result.baseUrl,
            dbUrls: result.dbUrls,
            authSecret: result.authSecret,
            stalePorts: result.stalePorts,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`repoRoot: ${result.repoRoot}`);
      console.log(`baseUrl:  ${result.baseUrl}`);
      for (const key of Object.keys(result.dbUrls)) {
        console.log(`${key}=[configured]`);
      }
    }
  } catch (error) {
    console.error(`[regression-env] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
