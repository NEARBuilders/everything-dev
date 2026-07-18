import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { config as loadDotenv } from "dotenv";
import type { RuntimeConfig } from "../types";

const POSTGRES_USER = "everythingdev";
const POSTGRES_PASSWORD = "everythingdev";
const API_DATABASE_SECRET = "API_DATABASE_URL";
const AUTH_DATABASE_SECRET = "AUTH_DATABASE_URL";
const HOST_SECRET = "CORS_ORIGIN";
const BASE_POSTGRES_PORT = 5434;
const BASE_REDIS_PORT = 6379;

export interface DatabaseSecretConfig {
  secret: string;
  slug: string;
  fromKey: string;
  port: number;
  serviceName: string;
  containerName: string;
  databaseName: string;
  volumeName: string;
  url: string;
}

export interface RedisSecretConfig {
  secret: string;
  slug: string;
  fromKey: string;
  port: number;
  serviceName: string;
  containerName: string;
  volumeName: string;
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

export interface PortState {
  postgresPorts: Record<string, number>;
  redisPorts: Record<string, number>;
  devPorts?: DevPortState;
}

export interface GeneratedInfraSpec {
  groups: SecretGroup[];
  databases: DatabaseSecretConfig[];
  redis: RedisSecretConfig[];
}

interface SyncGeneratedInfraResult {
  secrets: string[];
  envExampleChanged: boolean;
  dockerComposeChanged: boolean;
  staleEnvWarnings: string[];
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
  if (!configDir) return { postgresPorts: {}, redisPorts: {} };
  const statePath = join(configDir, ".bos", "infra-state.json");
  if (!existsSync(statePath)) return { postgresPorts: {}, redisPorts: {} };
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf-8")) as Partial<PortState>;
    return {
      postgresPorts: raw.postgresPorts ?? {},
      redisPorts: raw.redisPorts ?? {},
      devPorts: raw.devPorts,
    };
  } catch {
    return { postgresPorts: {}, redisPorts: {} };
  }
}

export function savePortState(configDir: string, state: PortState): void {
  const statePath = join(configDir, ".bos", "infra-state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export type { DevPortState };

function resolvePort(slug: string, portMap: Record<string, number>, basePort: number): number {
  if (portMap[slug] !== undefined) return portMap[slug];
  const assigned = Object.values(portMap);
  const maxAssigned = assigned.length > 0 ? Math.max(...assigned) : basePort - 1;
  const next = Math.max(maxAssigned + 1, basePort);
  portMap[slug] = next;
  return next;
}

export function normalizeRedisSlug(secret: string): string {
  return secret.replace(/_REDIS_URL$/, "").toLowerCase();
}

export function getSecretGroups(runtimeConfig: RuntimeConfig): SecretGroup[] {
  const groups: SecretGroup[] = [];
  const seen = new Set<string>();

  const addGroup = (section: string, secrets: string[]) => {
    const filtered = secrets.filter((s) => {
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

function buildGeneratedInfraSpec(
  runtimeConfig: RuntimeConfig,
  configDir?: string,
): { spec: GeneratedInfraSpec; portState: PortState } {
  const groups = getSecretGroups(runtimeConfig);
  const allSecrets = groups.flatMap((group) => group.secrets);
  const originMap = configDir ? buildOriginMap(configDir, runtimeConfig) : new Map();
  const portState = loadPortState(configDir);

  const databases = buildDatabaseConfigs(allSecrets, originMap, portState.postgresPorts);
  const redis = buildRedisConfigs(allSecrets, originMap, portState.redisPorts);

  return { spec: { groups, databases, redis }, portState };
}

export function normalizeDatabaseSlug(secret: string): string {
  return secret.replace(/_DATABASE_URL$/, "").toLowerCase();
}

export function buildOriginMap(
  configDir: string,
  runtimeConfig: RuntimeConfig,
): Map<string, string> {
  const configPath = join(configDir, "bos.config.json");

  const originMap = new Map<string, string>();
  const account = runtimeConfig.account;

  const resolveOrigin = (extendsRef: unknown): string | null => {
    if (typeof extendsRef === "string") {
      const match = extendsRef.match(/^bos:\/\/([^/]+)\//);
      return match?.[1] ?? null;
    }
    return null;
  };

  const rawConfig = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>)
    : null;
  const rawPlugins = rawConfig?.plugins as Record<string, unknown> | undefined;

  for (const secret of runtimeConfig.api.secrets ?? []) {
    if (!originMap.has(secret)) originMap.set(secret, account);
  }

  const rawApp = rawConfig?.app as Record<string, unknown> | undefined;
  const authExtends = (rawApp?.auth as Record<string, unknown> | undefined)?.extends;
  const authOrigin = resolveOrigin(authExtends) ?? account;
  for (const secret of runtimeConfig.auth?.secrets ?? []) {
    if (!originMap.has(secret)) originMap.set(secret, authOrigin);
  }

  for (const [pluginKey, pluginEntry] of Object.entries(runtimeConfig.plugins ?? {})) {
    const rawPlugin = rawPlugins?.[pluginKey];
    let pluginOrigin: string;
    if (typeof rawPlugin === "string") {
      pluginOrigin = resolveOrigin(rawPlugin) ?? account;
    } else if (rawPlugin && typeof rawPlugin === "object") {
      pluginOrigin = resolveOrigin((rawPlugin as Record<string, unknown>).extends) ?? account;
    } else {
      pluginOrigin = account;
    }
    for (const secret of pluginEntry.secrets ?? []) {
      if (!originMap.has(secret)) originMap.set(secret, pluginOrigin);
    }
  }

  for (const secret of runtimeConfig.host.secrets ?? []) {
    if (!originMap.has(secret)) originMap.set(secret, account);
  }

  return originMap;
}

export function buildDatabaseConfigs(
  secrets: string[],
  originMap: Map<string, string>,
  portMap: Record<string, number>,
): DatabaseSecretConfig[] {
  const databaseSecrets = uniqueSecrets(
    secrets.filter((secret) => secret.endsWith("_DATABASE_URL")),
  );

  const orderedSecrets = [...databaseSecrets];

  // Prune stale entries from removed plugins
  const currentSlugs = new Set(orderedSecrets.map(normalizeDatabaseSlug));
  for (const slug of Object.keys(portMap)) {
    if (!currentSlugs.has(slug)) delete portMap[slug];
  }

  // Sort by slug for deterministic assignment order
  orderedSecrets.sort((a, b) => normalizeDatabaseSlug(a).localeCompare(normalizeDatabaseSlug(b)));

  for (const secret of orderedSecrets) {
    const slug = normalizeDatabaseSlug(secret);
    if (secret === API_DATABASE_SECRET) {
      portMap[slug] = 5432;
    } else if (secret === AUTH_DATABASE_SECRET) {
      portMap[slug] = 5433;
    } else {
      resolvePort(slug, portMap, BASE_POSTGRES_PORT);
    }
  }

  return orderedSecrets.map((secret) => {
    const slug = normalizeDatabaseSlug(secret);
    const fromKey = originMap.get(secret) ?? "";
    const port = portMap[slug];

    const volumeName = fromKey
      ? `${fromKey.replace(/\./g, "_")}_postgres_${slug}_data`
      : `postgres_${slug}_data`;

    const containerName = fromKey ? `${fromKey}-postgres-${slug}` : `postgres-${slug}`;

    return {
      secret,
      slug,
      fromKey,
      port,
      serviceName: `postgres-${slug.replace(/_/g, "-")}`,
      containerName,
      databaseName: `${slug}_db`,
      volumeName,
      url: `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${slug}_db`,
    };
  });
}

export function buildRedisConfigs(
  secrets: string[],
  originMap: Map<string, string>,
  portMap: Record<string, number>,
): RedisSecretConfig[] {
  const redisSecrets = uniqueSecrets(secrets.filter((secret) => secret.endsWith("_REDIS_URL")));
  const orderedSecrets = [...redisSecrets];

  // Prune stale entries from removed plugins
  const currentSlugs = new Set(orderedSecrets.map(normalizeRedisSlug));
  for (const slug of Object.keys(portMap)) {
    if (!currentSlugs.has(slug)) delete portMap[slug];
  }

  // Sort by slug for deterministic assignment order
  orderedSecrets.sort((a, b) => normalizeRedisSlug(a).localeCompare(normalizeRedisSlug(b)));

  for (const secret of orderedSecrets) {
    const slug = normalizeRedisSlug(secret);
    resolvePort(slug, portMap, BASE_REDIS_PORT);
  }

  return orderedSecrets.map((secret) => {
    const slug = normalizeRedisSlug(secret);
    const fromKey = originMap.get(secret) ?? "";
    const port = portMap[slug];

    const volumeName = fromKey
      ? `${fromKey.replace(/\./g, "_")}_redis_${slug}_data`
      : `redis_${slug}_data`;

    const containerName = fromKey ? `${fromKey}-redis-${slug}` : `redis-${slug}`;

    return {
      secret,
      slug,
      fromKey,
      port,
      serviceName: `redis-${slug.replace(/_/g, "-")}`,
      containerName,
      volumeName,
      url: `redis://localhost:${port}`,
    };
  });
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

function defaultSecretValue(
  secret: string,
  databases: Map<string, DatabaseSecretConfig>,
  redisConfigs: Map<string, RedisSecretConfig>,
  options: { forExample: boolean; devHostPort?: number },
): string {
  if (secret === "BETTER_AUTH_SECRET") {
    return options.forExample ? "" : randomBytes(32).toString("base64url");
  }

  if (secret === "CORS_ORIGIN") {
    if (typeof options.devHostPort === "number") {
      return `http://localhost:${options.devHostPort}`;
    }
    return "http://localhost:3000";
  }

  return databases.get(secret)?.url ?? redisConfigs.get(secret)?.url ?? "";
}

function renderEnvFile(
  groups: SecretGroup[],
  databases: DatabaseSecretConfig[],
  redisConfigs: RedisSecretConfig[],
  options: { forExample: boolean; devHostPort?: number },
): string {
  const databaseMap = new Map(databases.map((entry) => [entry.secret, entry]));
  const redisMap = new Map(redisConfigs.map((entry) => [entry.secret, entry]));
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

function renderDockerCompose(
  databases: DatabaseSecretConfig[],
  redisConfigs: RedisSecretConfig[],
  projectName: string,
): string {
  const lines = [`name: ${projectName}`, ""];

  if (databases.length > 0) {
    lines.push(
      "x-pg-common: &pg-common",
      "  image: postgres:17-alpine",
      "  environment: &pg-env",
      `    POSTGRES_USER: ${POSTGRES_USER}`,
      `    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`,
      "  healthcheck:",
      '    test: ["CMD-SHELL", "pg_isready -U everythingdev"]',
      "    interval: 3s",
      "    timeout: 3s",
      "    retries: 5",
      "",
    );
  }

  if (redisConfigs.length > 0) {
    lines.push(
      "x-redis-common: &redis-common",
      "  image: redis:7-alpine",
      "  command: redis-server --appendonly yes",
      "  healthcheck:",
      '    test: ["CMD", "redis-cli", "ping"]',
      "    interval: 3s",
      "    timeout: 3s",
      "    retries: 5",
      "",
    );
  }

  lines.push("services:");

  for (const database of databases) {
    lines.push(`  ${database.serviceName}:`);
    lines.push("    <<: *pg-common");
    lines.push(`    container_name: ${database.containerName}`);
    lines.push("    environment:");
    lines.push("      <<: *pg-env");
    lines.push(`      POSTGRES_DB: ${database.databaseName}`);
    lines.push("    ports:");
    lines.push(`      - "${database.port}:5432"`);
    lines.push("    volumes:");
    lines.push(`      - ${database.volumeName}:/var/lib/postgresql/data`);
    lines.push("");
  }

  for (const redis of redisConfigs) {
    lines.push(`  ${redis.serviceName}:`);
    lines.push("    <<: *redis-common");
    lines.push(`    container_name: ${redis.containerName}`);
    lines.push("    ports:");
    lines.push(`      - "${redis.port}:6379"`);
    lines.push("    volumes:");
    lines.push(`      - ${redis.volumeName}:/data`);
    lines.push("");
  }

  lines.push("volumes:");
  for (const database of databases) {
    lines.push(`  ${database.volumeName}:`);
    lines.push(`    name: ${database.volumeName}`);
  }
  for (const redis of redisConfigs) {
    lines.push(`  ${redis.volumeName}:`);
    lines.push(`    name: ${redis.volumeName}`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderEnvFileFromPlan(env: Record<string, string>, devHostPort?: number): string {
  const lines: string[] = [
    "# Generated from bos dev infra plan",
    "# Update values as needed for your local environment",
    "",
  ];
  const sortedKeys = Object.keys(env).sort();
  for (const key of sortedKeys) {
    let value = env[key];
    if (key === "CORS_ORIGIN" && devHostPort && !value) {
      value = `http://localhost:${devHostPort}`;
    }
    lines.push(`${key}=${value}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderDockerComposeFromPlan(
  databases: {
    serviceName: string;
    containerName: string;
    port: number;
    volumeName: string;
    databaseName: string;
  }[],
  redis: { serviceName: string; containerName: string; port: number; volumeName: string }[],
  projectName: string,
): string {
  const lines = [`name: ${projectName}`, ""];

  if (databases.length > 0) {
    lines.push(
      "x-pg-common: &pg-common",
      "  image: postgres:17-alpine",
      "  environment: &pg-env",
      `    POSTGRES_USER: ${POSTGRES_USER}`,
      `    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`,
      "  healthcheck:",
      '    test: ["CMD-SHELL", "pg_isready -U everythingdev"]',
      "    interval: 3s",
      "    timeout: 3s",
      "    retries: 5",
      "",
    );
  }

  if (redis.length > 0) {
    lines.push(
      "x-redis-common: &redis-common",
      "  image: redis:7-alpine",
      "  command: redis-server --appendonly yes",
      "  healthcheck:",
      '    test: ["CMD", "redis-cli", "ping"]',
      "    interval: 3s",
      "    timeout: 3s",
      "    retries: 5",
      "",
    );
  }

  lines.push("services:");

  for (const db of databases) {
    lines.push(`  ${db.serviceName}:`);
    lines.push("    <<: *pg-common");
    lines.push(`    container_name: ${db.containerName}`);
    lines.push("    environment:");
    lines.push("      <<: *pg-env");
    lines.push(`      POSTGRES_DB: ${db.databaseName}`);
    lines.push("    ports:");
    lines.push(`      - "${db.port}:5432"`);
    lines.push("    volumes:");
    lines.push(`      - ${db.volumeName}:/var/lib/postgresql/data`);
    lines.push("");
  }

  for (const r of redis) {
    lines.push(`  ${r.serviceName}:`);
    lines.push("    <<: *redis-common");
    lines.push(`    container_name: ${r.containerName}`);
    lines.push("    ports:");
    lines.push(`      - "${r.port}:6379"`);
    lines.push("    volumes:");
    lines.push(`      - ${r.volumeName}:/data`);
    lines.push("");
  }

  lines.push("volumes:");
  for (const db of databases) {
    lines.push(`  ${db.volumeName}:`);
    lines.push(`    name: ${db.volumeName}`);
  }
  for (const r of redis) {
    lines.push(`  ${r.volumeName}:`);
    lines.push(`    name: ${r.volumeName}`);
  }

  return `${lines.join("\n")}\n`;
}

export function materializeInfraPlan(
  configDir: string,
  planEnv: Record<string, string>,
  planDatabases: {
    serviceName: string;
    containerName: string;
    port: number;
    volumeName: string;
    databaseName: string;
  }[],
  planRedis: { serviceName: string; containerName: string; port: number; volumeName: string }[],
  projectName: string,
  devHostPort?: number,
): { envExampleChanged: boolean; dockerComposeChanged: boolean } {
  const envContent = renderEnvFileFromPlan(planEnv, devHostPort);
  const dockerContent = renderDockerComposeFromPlan(planDatabases, planRedis, projectName);

  const envExamplePath = join(configDir, ".env.example");
  const dockerComposePath = join(configDir, "docker-compose.yml");

  return {
    envExampleChanged: syncTextFile(envExamplePath, envContent),
    dockerComposeChanged: syncTextFile(dockerComposePath, dockerContent),
  };
}

function syncTextFile(filePath: string, nextContent: string): boolean {
  if (existsSync(filePath) && readFileSync(filePath, "utf-8") === nextContent) {
    return false;
  }

  writeFileSync(filePath, nextContent);
  return true;
}

export function writeGeneratedInfra(configDir: string, runtimeConfig: RuntimeConfig): string[] {
  const result = syncGeneratedInfra(configDir, runtimeConfig);

  if (result.staleEnvWarnings.length > 0) {
    p.log.warn(
      `.env has ${result.staleEnvWarnings.length} stale value(s) compared to .env.example:`,
    );
    for (const warning of result.staleEnvWarnings) {
      p.log.message(`  ${warning}`);
    }
  }

  return result.secrets;
}

export function syncGeneratedInfra(
  configDir: string,
  runtimeConfig: RuntimeConfig,
): SyncGeneratedInfraResult {
  const { spec, portState } = buildGeneratedInfraSpec(runtimeConfig, configDir);
  const secrets = spec.groups.flatMap((group) => group.secrets);
  const envOptions: { forExample: true; devHostPort?: number } = { forExample: true };
  if (runtimeConfig.env === "development") {
    envOptions.devHostPort = resolveDevHostPort(runtimeConfig);
  }
  const newEnvContent = renderEnvFile(spec.groups, spec.databases, spec.redis, envOptions);
  const newDockerContent = renderDockerCompose(spec.databases, spec.redis, runtimeConfig.account);

  const envExamplePath = join(configDir, ".env.example");
  const dockerComposePath = join(configDir, "docker-compose.yml");

  const staleWarnings = checkEnvStaleness(configDir, spec.databases, spec.redis);

  if (configDir) {
    savePortState(configDir, portState);
  }

  return {
    secrets,
    envExampleChanged: syncTextFile(envExamplePath, newEnvContent),
    dockerComposeChanged: syncTextFile(dockerComposePath, newDockerContent),
    staleEnvWarnings: staleWarnings,
  };
}

function checkEnvStaleness(
  configDir: string,
  databases: DatabaseSecretConfig[],
  redisConfigs: RedisSecretConfig[],
): string[] {
  const envPath = join(configDir, ".env");
  if (!existsSync(envPath)) return [];

  const existingEnv = readFileSync(envPath, "utf-8");
  const envMap = new Map<string, string>();
  for (const line of existingEnv.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) envMap.set(match[1], match[2]);
  }

  const stale: string[] = [];

  for (const db of databases) {
    const existing = envMap.get(db.secret);
    if (existing && existing !== db.url) {
      const oldPort = extractPortFromUrl(existing) ?? "?";
      stale.push(`${db.secret}: port ${oldPort} → ${db.port}`);
    }
  }

  for (const redis of redisConfigs) {
    const existing = envMap.get(redis.secret);
    if (existing && existing !== redis.url) {
      const oldPort = extractPortFromUrl(existing) ?? "?";
      stale.push(`${redis.secret}: port ${oldPort} → ${redis.port}`);
    }
  }

  return stale;
}

export function ensureEnvFile(configDir: string): void {
  const envPath = join(configDir, ".env");
  const examplePath = join(configDir, ".env.example");

  if (existsSync(envPath) || !existsSync(examplePath)) return;

  const content = readFileSync(examplePath, "utf-8");
  const lines = content.split("\n");
  const secret = randomBytes(32).toString("base64url");
  const updated = lines
    .map((line) => {
      if (/^BETTER_AUTH_SECRET=/.test(line)) {
        return `BETTER_AUTH_SECRET=${secret}`;
      }
      return line;
    })
    .join("\n");

  writeFileSync(envPath, updated);
  p.log.info("Created .env from generated .env.example with generated BETTER_AUTH_SECRET");
}

let envLoadedDir: string | null = null;

export function loadProjectEnv(configDir: string): void {
  if (envLoadedDir === configDir) return;
  const envPath = join(configDir, ".env");
  if (!existsSync(envPath)) return;

  loadDotenv({ path: envPath, processEnv: process.env, quiet: true });
  envLoadedDir = configDir;
}
