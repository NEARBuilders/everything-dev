import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeConfig } from "../types";

const POSTGRES_USER = "everythingdev";
const POSTGRES_PASSWORD = "everythingdev";
const AUTH_DATABASE_SECRET = "AUTH_DATABASE_URL";
const HOST_SECRET = "CORS_ORIGIN";
const REDIS_PORT = 6379;
const TEST_AUTH_SECRET = "regression-test-secret-do-not-use-in-production";
const VESTIGIAL_SECRETS = new Set([
  "NEAR_RELAYER_PRIVATE_KEY_MAINNET",
  "NEAR_RELAYER_PRIVATE_KEY_TESTNET",
]);

/**
 * Fixed local-development database conventions. The committed
 * docker-compose.yml provisions exactly these services/ports — nothing is
 * derived from runtime config. Every non-auth `*_DATABASE_URL` secret shares
 * the api database (schema-isolated per plugin); auth gets its own.
 */
const DEV_API_DB_PORT = 5432;
const DEV_AUTH_DB_PORT = 5433;
const TEST_API_DB_PORT = 5434;
const TEST_AUTH_DB_PORT = 5435;

export interface DatabaseConvention {
  secret: string;
  slug: string;
  port: number;
  databaseName: string;
  url: string;
}

export interface RedisConvention {
  secret: string;
  slug: string;
  port: number;
  url: string;
}

export interface SecretGroup {
  section: string;
  secrets: string[];
}

interface DevPortState {
  host?: number;
  api?: number;
  ui?: number;
  auth?: number;
  pluginPortStart?: number;
}

export type { DevPortState };

export interface PortState {
  devPorts?: DevPortState;
}

function uniqueSecrets(values: Array<string | undefined>): string[] {
  const secrets: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    secrets.push(value);
  }

  return secrets;
}

export function loadPortState(configDir?: string): PortState {
  if (!configDir) return {};
  const statePath = join(configDir, ".bos", "infra-state.json");
  if (!existsSync(statePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Partial<PortState>;
    return { devPorts: raw.devPorts };
  } catch {
    return {};
  }
}

export function savePortState(configDir: string, state: PortState): void {
  const statePath = join(configDir, ".bos", "infra-state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function normalizeDatabaseSlug(secret: string): string {
  return secret.replace(/_DATABASE_URL$/, "").toLowerCase();
}

function normalizeRedisSlug(secret: string): string {
  return secret.replace(/_REDIS_URL$/, "").toLowerCase();
}

function databaseUrl(port: number, databaseName: string): string {
  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${databaseName}`;
}

export function buildConventionalDatabases(secrets: string[]): DatabaseConvention[] {
  const databaseSecrets = uniqueSecrets(
    secrets.filter((secret) => secret.endsWith("_DATABASE_URL")),
  );

  return databaseSecrets
    .sort((a, b) => normalizeDatabaseSlug(a).localeCompare(normalizeDatabaseSlug(b)))
    .map((secret) => {
      const slug = normalizeDatabaseSlug(secret);
      const isAuth = secret === AUTH_DATABASE_SECRET;
      const port = isAuth ? DEV_AUTH_DB_PORT : DEV_API_DB_PORT;
      const databaseName = isAuth ? "auth_db" : "api_db";
      return { secret, slug, port, databaseName, url: databaseUrl(port, databaseName) };
    });
}

export function buildConventionalRedis(secrets: string[]): RedisConvention[] {
  const redisSecrets = uniqueSecrets(secrets.filter((secret) => secret.endsWith("_REDIS_URL")));

  return redisSecrets
    .sort((a, b) => normalizeRedisSlug(a).localeCompare(normalizeRedisSlug(b)))
    .map((secret) => ({
      secret,
      slug: normalizeRedisSlug(secret),
      port: REDIS_PORT,
      url: `redis://localhost:${REDIS_PORT}`,
    }));
}

function testDatabaseUrl(secret: string): string {
  const isAuth = secret === AUTH_DATABASE_SECRET;
  const port = isAuth ? TEST_AUTH_DB_PORT : TEST_API_DB_PORT;
  const databaseName = isAuth ? "auth_test_db" : "api_test_db";
  return databaseUrl(port, databaseName);
}

export function getSecretGroups(runtimeConfig: RuntimeConfig): SecretGroup[] {
  const groups: SecretGroup[] = [];
  const seen = new Set<string>();

  const addGroup = (section: string, secrets: string[]) => {
    const filtered = secrets.filter((s) => {
      if (VESTIGIAL_SECRETS.has(s)) return false;
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
    if (filtered.length > 0) {
      groups.push({ section, secrets: filtered });
    }
  };

  addGroup("app.host", uniqueSecrets([...(runtimeConfig.host.secrets ?? []), HOST_SECRET]));

  addGroup("app.api", uniqueSecrets(runtimeConfig.api.secrets ?? []));

  if (runtimeConfig.auth) {
    addGroup("app.auth", uniqueSecrets(runtimeConfig.auth.secrets ?? []));
  }

  if (runtimeConfig.plugins) {
    for (const [pluginKey, plugin] of Object.entries(runtimeConfig.plugins)) {
      if (plugin.secrets && plugin.secrets.length > 0) {
        addGroup(`plugins.${pluginKey}`, plugin.secrets);
      }
    }
  }

  return groups;
}

function extractPortFromUrl(url: string): string | null {
  const match = url.match(/:(\d{4,5})(?:\/|$)/);
  return match?.[1] ?? null;
}

function resolveDevHostPort(runtimeConfig: RuntimeConfig): number {
  if (typeof runtimeConfig.host?.port === "number") return runtimeConfig.host.port;
  const fromUrl = runtimeConfig.host?.url ? extractPortFromUrl(runtimeConfig.host.url) : null;
  if (fromUrl) {
    const parsed = Number.parseInt(fromUrl, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 3000;
}

export { resolveDevHostPort };

function defaultSecretValue(
  secret: string,
  databases: Map<string, DatabaseConvention>,
  redisConfigs: Map<string, RedisConvention>,
  options: { forExample: boolean; devHostPort?: number },
): string {
  if (secret === "BETTER_AUTH_SECRET") {
    return options.forExample ? "" : randomBytes(32).toString("base64url");
  }

  if (secret === "CORS_ORIGIN") {
    if (options.forExample) {
      return "http://localhost:3000";
    }
    if (typeof options.devHostPort === "number") {
      return `http://localhost:${options.devHostPort}`;
    }
    return "http://localhost:3000";
  }

  return databases.get(secret)?.url ?? redisConfigs.get(secret)?.url ?? "";
}

function renderEnvFile(
  groups: SecretGroup[],
  options: { forExample: boolean; devHostPort?: number },
): string {
  const allSecrets = groups.flatMap((group) => group.secrets);
  const databaseMap = new Map(
    buildConventionalDatabases(allSecrets).map((entry) => [entry.secret, entry]),
  );
  const redisMap = new Map(
    buildConventionalRedis(allSecrets).map((entry) => [entry.secret, entry]),
  );
  const lines: string[] = [
    "# Generated from configured bos secrets",
    "# Update values as needed for your local environment",
    "",
  ];

  for (const group of groups) {
    lines.push(`# ${group.section}`);
    for (const secret of group.secrets) {
      lines.push(`${secret}=${defaultSecretValue(secret, databaseMap, redisMap, options)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export { renderEnvFile };

function renderEnvTestFile(groups: SecretGroup[]): string {
  const lines: string[] = [
    "# Generated test environment — loaded by test suites instead of .env",
    "# Test databases run on dedicated *-test docker-compose services",
    "",
  ];

  for (const group of groups) {
    const entries: string[] = [];
    for (const secret of group.secrets) {
      if (secret === "BETTER_AUTH_SECRET") {
        entries.push(`${secret}=${TEST_AUTH_SECRET}`);
      } else if (secret.endsWith("_DATABASE_URL")) {
        entries.push(`${secret}=${testDatabaseUrl(secret)}`);
      }
    }
    if (entries.length > 0) {
      lines.push(`# ${group.section}`);
      lines.push(...entries);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

export { renderEnvTestFile };

export interface CiServiceSpec {
  key: string;
  slug: string;
  image: string;
  env: Record<string, string>;
  ports: string[];
  healthcheck?: { test: string[]; interval: string; timeout: string; retries: number };
  volumes: string[];
  database?: { user: string; password: string; name: string };
}

export interface CiInfraPlan {
  account: string;
  gateway: string;
  project: string;
  env: Record<string, string>;
  services: CiServiceSpec[];
  generatedAt: string;
}

export function buildCiInfraPlan(
  runtimeConfig: RuntimeConfig,
  options: { hostPortOverride?: number } = {},
): CiInfraPlan {
  const allSecrets = collectAllSecrets(runtimeConfig);
  const databases = buildConventionalDatabases(allSecrets);
  const redisConfigs = buildConventionalRedis(allSecrets);

  const hostPort =
    options.hostPortOverride ??
    (Number.isFinite(Number(process.env.BOS_CI_HOST_PORT))
      ? Number(process.env.BOS_CI_HOST_PORT)
      : undefined) ??
    resolveDevHostPort(runtimeConfig);
  const env: Record<string, string> = {};
  for (const db of databases) env[db.secret] = db.url;
  for (const r of redisConfigs) env[r.secret] = r.url;

  env.CORS_ORIGIN = `http://127.0.0.1:${hostPort}`;
  if (!env.BETTER_AUTH_SECRET) env.BETTER_AUTH_SECRET = "";

  const services: CiServiceSpec[] = [];
  const seenPorts = new Set<number>();

  for (const db of databases) {
    if (seenPorts.has(db.port)) continue;
    seenPorts.add(db.port);
    services.push({
      key: db.slug,
      slug: db.slug,
      image: "postgres:17-alpine",
      env: {
        POSTGRES_USER: POSTGRES_USER,
        POSTGRES_PASSWORD: POSTGRES_PASSWORD,
        POSTGRES_DB: db.databaseName,
      },
      ports: [`${db.port}:5432`],
      healthcheck: {
        test: ["CMD-SHELL", `pg_isready -U ${POSTGRES_USER} -d ${db.databaseName}`],
        interval: "3s",
        timeout: "3s",
        retries: 10,
      },
      volumes: [`${db.slug}_data:/var/lib/postgresql/data`],
      database: { user: POSTGRES_USER, password: POSTGRES_PASSWORD, name: db.databaseName },
    });
  }

  for (const r of redisConfigs) {
    services.push({
      key: r.slug,
      slug: r.slug,
      image: "redis:7-alpine",
      env: {},
      ports: [`${r.port}:6379`],
      healthcheck: {
        test: ["CMD", "redis-cli", "ping"],
        interval: "3s",
        timeout: "3s",
        retries: 10,
      },
      volumes: [`${r.slug}_data:/data`],
    });
  }

  return {
    account: runtimeConfig.account,
    gateway: runtimeConfig.domain ?? runtimeConfig.account,
    project: runtimeConfig.account,
    env,
    services,
    generatedAt: new Date().toISOString(),
  };
}

function collectAllSecrets(runtimeConfig: RuntimeConfig): string[] {
  const all: string[] = [];
  all.push(...(runtimeConfig.host.secrets ?? []));
  all.push(...(runtimeConfig.api.secrets ?? []));
  if (runtimeConfig.auth) all.push(...(runtimeConfig.auth.secrets ?? []));
  if (runtimeConfig.plugins) {
    for (const plugin of Object.values(runtimeConfig.plugins)) {
      if (plugin.secrets) all.push(...plugin.secrets);
    }
  }
  return all.filter((s) => !VESTIGIAL_SECRETS.has(s));
}
