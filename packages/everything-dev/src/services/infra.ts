import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeConfig } from "../types";
import { frameworkOwnedHeaderComment } from "./scaffold/ownership";

const HOST_SECRET = "CORS_ORIGIN";
const REDIS_PORT = 6379;
const TEST_AUTH_SECRET = "regression-test-secret-do-not-use-in-production";
const VESTIGIAL_SECRETS = new Set([
  "NEAR_RELAYER_PRIVATE_KEY_MAINNET",
  "NEAR_RELAYER_PRIVATE_KEY_TESTNET",
]);

/**
 * Local development conventions. Databases default to a persistent,
 * file-backed PGlite data dir per workspace process (`.bos/db`) — no ports,
 * no docker. Operators point a secret at a `postgres://` URL to demand a
 * shared server. The two-database split (auth separate from everything
 * else) survives independent of compose.
 */
export const PGLITE_DEV_DATABASE_URL = "pglite:.bos/db";
export const PGLITE_TEST_DATABASE_URL = "pglite::memory:";

export interface DatabaseConvention {
  secret: string;
  slug: string;
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

function databaseUrl(): string {
  return PGLITE_DEV_DATABASE_URL;
}

export function buildConventionalDatabases(secrets: string[]): DatabaseConvention[] {
  const databaseSecrets = uniqueSecrets(
    secrets.filter((secret) => secret.endsWith("_DATABASE_URL")),
  );

  return databaseSecrets
    .sort((a, b) => normalizeDatabaseSlug(a).localeCompare(normalizeDatabaseSlug(b)))
    .map((secret) => {
      const slug = normalizeDatabaseSlug(secret);
      return { secret, slug, url: databaseUrl() };
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

function testDatabaseUrl(): string {
  return PGLITE_TEST_DATABASE_URL;
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

  // Zero-config dev (plan 055 ticket 11): substrate URLs are opt-in — the
  // example renders them empty so the consumers' persistent pglite boot
  // defaults apply; the operator sets a postgres:// URL for production or
  // shared access.
  if (options.forExample) {
    return "";
  }

  return databases.get(secret)?.url ?? redisConfigs.get(secret)?.url ?? "";
}

/**
 * Plugin `*_DATABASE_URL` secrets share the API database (the platform's
 * two-database contract), so they are not rendered as template entries —
 * the host falls back to `API_DATABASE_URL` when they are unset.
 */
function isFallbackDatabaseSecret(secret: string): boolean {
  return (
    secret.endsWith("_DATABASE_URL") &&
    secret !== "API_DATABASE_URL" &&
    secret !== "AUTH_DATABASE_URL"
  );
}

function renderEnvFile(
  groups: SecretGroup[],
  options: { forExample: boolean; devHostPort?: number },
): string {
  const rendered = groups
    .map((group) => ({
      section: group.section,
      secrets: group.secrets.filter((secret) => !isFallbackDatabaseSecret(secret)),
    }))
    .filter((group) => group.secrets.length > 0);
  const allSecrets = rendered.flatMap((group) => group.secrets);
  const databaseMap = new Map(
    buildConventionalDatabases(allSecrets).map((entry) => [entry.secret, entry]),
  );
  const redisMap = new Map(
    buildConventionalRedis(allSecrets).map((entry) => [entry.secret, entry]),
  );
  const lines: string[] = options.forExample
    ? [
        ...frameworkOwnedHeaderComment("hash").trimEnd().split("\n"),
        "",
        "# Generated from configured bos secrets",
        "# Update values as needed for your local environment",
        "",
      ]
    : [
        "# Generated from configured bos secrets",
        "# Update values as needed for your local environment",
        "",
      ];

  for (const group of rendered) {
    lines.push(`# ${group.section}`);
    for (const secret of group.secrets) {
      if (
        options.forExample &&
        (secret.endsWith("_DATABASE_URL") || secret.endsWith("_REDIS_URL"))
      ) {
        lines.push(
          secret.endsWith("_REDIS_URL")
            ? "# Leave empty for dev defaults; set a redis:// URL to opt into a real Redis."
            : "# Leave empty for the persistent local PGlite default (.bos/db); set a postgres:// URL for production or shared access.",
        );
      }
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
    "# Test databases run on in-memory pglite — no docker involved",
    "",
  ];

  for (const group of groups) {
    const entries: string[] = [];
    for (const secret of group.secrets) {
      if (secret === "BETTER_AUTH_SECRET") {
        entries.push(`${secret}=${TEST_AUTH_SECRET}`);
      } else if (secret.endsWith("_DATABASE_URL")) {
        entries.push(`${secret}=${testDatabaseUrl()}`);
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
