import fs from "node:fs";
import path from "node:path";
import type { PluginLoadFailureInfo } from "every-plugin/errors";
import { createAuthTestInstance } from "../../lib/auth-test-instance.ts";
import { seedMemberFixtures } from "../../lib/member-seed.ts";
import { migrateTestDatabase } from "../../lib/migrate-test-db.mjs";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";

const ADMIN_COOKIES_PATH = ".bos/regression/admin-cookies.json";
const LOGOUT_COOKIES_PATH = ".bos/regression/logout-cookies.json";
const ADMIN_SEED_PATH = ".bos/regression/admin-seed.json";
const ADMIN_NAME = "admin.near";
const LOGOUT_NAME = "logout.near";

/**
 * The stack serves /health 200 even when a plugin failed to load (degraded
 * status). Specs that need the failed plugin would then fail with confusing
 * downstream timeouts, so abort here where the structured failure info is.
 */
async function failOnPluginLoadFailures(baseUrl: string) {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`[global-setup] /health returned ${response.status}`);
  }
  const health = (await response.json()) as { failures?: PluginLoadFailureInfo[] };
  if (health.failures?.length) {
    const rendered = health.failures
      .map(
        (f) =>
          `- ${f.pluginKey} (${f.operation ?? "load"}): [${f.kind}${f.retryable ? ", retryable" : ", permanent"}] ${f.message}${f.suggestion ? ` — ${f.suggestion}` : ""}`,
      )
      .join("\n");
    throw new Error(
      `[global-setup] the regression stack booted with failed plugin(s) — suite would fail with downstream timeouts:\n${rendered}`,
    );
  }
}

export default async function globalSetup() {
  const regressionEnv = computeRegressionEnv();
  const authDatabaseUrl = regressionEnv.dbUrls.AUTH_DATABASE_URL ?? "";
  const secret = regressionEnv.authSecret;

  await failOnPluginLoadFailures(regressionEnv.baseUrl);

  const { test } = await createAuthTestInstance({ authDatabaseUrl, secret });

  const unique = `${process.pid}`;
  const admin = await test.saveUser(
    test.createUser({
      email: `regression-admin-${unique}@regression.test`,
      name: ADMIN_NAME,
      role: "admin",
      emailVerified: true,
    }),
  );

  const orgAName = `regression-admin-org-a-${unique}`;
  const orgBName = `regression-admin-org-b-${unique}`;
  const orgA = await test.saveOrganization(
    test.createOrganization({ name: orgAName, slug: orgAName }),
  );
  const orgB = await test.saveOrganization(
    test.createOrganization({ name: orgBName, slug: orgBName }),
  );
  await test.addMember({ userId: admin.id, organizationId: orgA.id, role: "admin" });
  await test.addMember({ userId: admin.id, organizationId: orgB.id, role: "admin" });

  const cookies = await test.getCookies({ userId: admin.id, domain: "localhost" });

  const logoutUser = await test.saveUser(
    test.createUser({
      email: `regression-logout-${unique}@regression.test`,
      name: LOGOUT_NAME,
      emailVerified: true,
    }),
  );
  const logoutCookies = await test.getCookies({ userId: logoutUser.id, domain: "localhost" });

  const cookiesResolved = path.resolve(process.cwd(), ADMIN_COOKIES_PATH);
  fs.mkdirSync(path.dirname(cookiesResolved), { recursive: true });
  fs.writeFileSync(cookiesResolved, JSON.stringify(cookies, null, 2));
  console.log(`[global-setup] wrote ${cookiesResolved}`);

  const logoutCookiesResolved = path.resolve(process.cwd(), LOGOUT_COOKIES_PATH);
  fs.writeFileSync(logoutCookiesResolved, JSON.stringify(logoutCookies, null, 2));
  console.log(`[global-setup] wrote ${logoutCookiesResolved}`);

  const seedResolved = path.resolve(process.cwd(), ADMIN_SEED_PATH);
  fs.writeFileSync(
    seedResolved,
    JSON.stringify({ adminName: ADMIN_NAME, logoutName: LOGOUT_NAME, orgAName, orgBName }, null, 2),
  );
  console.log(`[global-setup] wrote ${seedResolved}`);

  await migrateTestDatabase({
    migrationsDir: "api/src/db/migrations",
    databaseUrl: regressionEnv.dbUrls.API_DATABASE_URL,
    schemaName: "plugin_api",
  });
  await seedMemberFixtures({ authDatabaseUrl, secret });
  console.log(`[global-setup] refreshed member fixtures`);
}
