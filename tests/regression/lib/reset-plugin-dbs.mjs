import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { computeRegressionEnv, findRepoRoot } from "./regression-env.mjs";

function pluginSchemaSlug(key) {
  return key
    .replace(/^@[^/]+\//, "")
    .replace(/-plugin$/, "")
    .replace(/[-\s]/g, "_")
    .toLowerCase();
}

function isLocalPlugin(entry) {
  const source = typeof entry?.development === "string" ? entry.development : "";
  return source.startsWith("local:");
}

function databaseSecretOf(entry) {
  return (entry?.secrets ?? []).find(
    (secret) => typeof secret === "string" && secret.endsWith("_DATABASE_URL"),
  );
}

function parsePostgresUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

export async function resetPluginDatabases({ repoRoot, env = process.env } = {}) {
  const root = repoRoot ?? findRepoRoot();
  if (!root) throw new Error("bos.config.json not found in any parent directory");
  const config = JSON.parse(fs.readFileSync(path.join(root, "bos.config.json"), "utf-8"));
  const resolved = computeRegressionEnv({ repoRoot: root, env });

  const targets = [];
  for (const [key, entry] of Object.entries(config.plugins ?? {})) {
    if (!isLocalPlugin(entry)) continue;
    const secret = databaseSecretOf(entry);
    if (!secret) continue;
    const url = resolved.dbUrls[secret];
    const target = parsePostgresUrl(url ?? "");
    if (!target) {
      console.warn(`[reset-plugin-dbs] skipping ${key}: no usable ${secret}`);
      continue;
    }
    targets.push({ key, schema: `plugin_${pluginSchemaSlug(key)}`, target });
  }

  const dropped = [];
  const targetsByDb = new Map();
  for (const { schema, target } of targets) {
    const client = new pg.Client({
      host: target.host,
      port: Number(target.port),
      user: target.user,
      password: target.password,
      database: target.database,
    });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      dropped.push(schema);
      const dbKey = `${target.host}:${target.port}/${target.database}`;
      if (!targetsByDb.has(dbKey)) targetsByDb.set(dbKey, target);
    } finally {
      await client.end();
    }
  }

  for (const target of targetsByDb.values()) {
    const client = new pg.Client({
      host: target.host,
      port: Number(target.port),
      user: target.user,
      password: target.password,
      database: target.database,
    });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "drizzle" CASCADE`);
    } finally {
      await client.end();
    }
  }

  if (dropped.length > 0) {
    console.log(`[reset-plugin-dbs] dropped: ${dropped.join(", ")}`);
  } else {
    console.log("[reset-plugin-dbs] no local plugin databases to reset");
  }
  return dropped;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  resetPluginDatabases()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[reset-plugin-dbs] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
