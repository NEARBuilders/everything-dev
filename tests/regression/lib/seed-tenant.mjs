import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { computeRegressionEnv, findRepoRoot } from "./regression-env.mjs";

function parsePostgresUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || "5432"),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

function randomId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export async function seedTenant(input) {
  const {
    subdomain,
    name,
    accountId,
    orgId = null,
    allowUiOverrides = true,
    allowBackendOverrides = false,
    allowSsr = false,
  } = input;

  const root = findRepoRoot();
  if (!root) throw new Error("bos.config.json not found in any parent directory");
  const resolved = computeRegressionEnv({ repoRoot: root });
  const url = resolved.dbUrls.API_DATABASE_URL;
  if (!url) throw new Error("API_DATABASE_URL is not configured for this workspace");
  const target = parsePostgresUrl(url);

  const client = new pg.Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
  });
  await client.connect();
  try {
    const located = await client.query(
      "SELECT table_schema FROM information_schema.tables WHERE table_name = 'tenants' AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema LIMIT 1",
    );
    const schema = located.rows[0]?.table_schema;
    if (!schema)
      throw new Error("tenants table not found in api database — did API migrations run?");
    await client.query(`SET search_path TO "${schema}", public`);

    const existing = await client.query(
      "SELECT id FROM tenants WHERE account_id = $1 AND deleted_at IS NULL LIMIT 1",
      [accountId],
    );
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      const binding = await client.query(
        "SELECT id FROM domain_bindings WHERE hostname = $1 LIMIT 1",
        [subdomain],
      );
      if (binding.rows.length === 0) {
        await client.query(
          "INSERT INTO domain_bindings (id, tenant_id, hostname, is_primary, is_verified, verification_token) VALUES ($1, $2, $3, true, true, $4)",
          [randomId(), id, subdomain, `regression-${randomId()}`],
        );
      }
      return { id, subdomain, accountId, orgId: null, reused: true };
    }

    const id = randomId();
    await client.query(
      "INSERT INTO tenants (id, account_id, org_id, name, status, owner_kind, allow_ui_overrides, allow_backend_overrides, allow_ssr) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        id,
        accountId,
        orgId,
        name,
        "active",
        "platform",
        allowUiOverrides,
        allowBackendOverrides,
        allowSsr,
      ],
    );
    await client.query(
      "INSERT INTO domain_bindings (id, tenant_id, hostname, is_primary, is_verified, verification_token) VALUES ($1, $2, $3, true, true, $4)",
      [randomId(), id, subdomain, `regression-${randomId()}`],
    );
    return { id, subdomain, accountId, orgId, reused: false };
  } finally {
    await client.end();
  }
}

const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const payload = process.argv[2];
  if (!payload) {
    console.error("usage: bun tests/regression/lib/seed-tenant.mjs '<json>'");
    process.exit(1);
  }
  seedTenant(JSON.parse(payload))
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[seed-tenant] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
