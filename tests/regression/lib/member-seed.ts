import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import * as authSchema from "../../../plugins/auth/src/db/schema.ts";
import { createAuthTestInstance } from "./auth-test-instance.ts";
import { seedTenant } from "./seed-tenant.mjs";

const MEMBER_COOKIES_PATH = ".bos/regression/cookies.json";
const MEMBER_SEED_PATH = ".bos/regression/seed.json";

/**
 * Seeds the member fixtures the browser regression suite consumes via
 * `injectCookies` / `loadSeedData`:
 *
 * - a member user + signed session cookie written to cookies.json
 * - two owned orgs with org A active on the session
 * - a tenant row + primary domain binding in the API database
 * - the matched seed.json metadata (org ids/names, tenant id/subdomain)
 *
 * Runs on every browser regression invocation (global-setup), so stale or
 * wiped fixtures never reach the specs. Mirrors the Go HTTP seeder
 * (tests/regression/http/seed_test.go) but goes straight to the databases
 * instead of the API, so it works with whichever stack is running.
 */
export async function seedMemberFixtures({
  authDatabaseUrl,
  secret,
}: {
  authDatabaseUrl: string;
  secret: string;
}) {
  if (!authDatabaseUrl) throw new Error("AUTH_DATABASE_URL is not configured");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");

  const { test, db, close } = await createAuthTestInstance({ authDatabaseUrl, secret });
  try {
    const unique = `${process.pid}`;
    const member = await test.saveUser(
      test.createUser({
        email: `regression-member-${unique}@citynode.test`,
        name: "member.near",
        emailVerified: true,
      }),
    );

    const orgAName = `regression-org-a-${unique}`;
    const orgBName = `regression-org-b-${unique}`;
    const orgA = await test.saveOrganization(
      test.createOrganization({ name: orgAName, slug: orgAName }),
    );
    const orgB = await test.saveOrganization(
      test.createOrganization({ name: orgBName, slug: orgBName }),
    );
    await test.addMember({ userId: member.id, organizationId: orgA.id, role: "owner" });
    await test.addMember({ userId: member.id, organizationId: orgB.id, role: "owner" });

    const { session, cookies } = await test.login({ userId: member.id });
    await db
      .update(authSchema.session)
      .set({ activeOrganizationId: orgA.id })
      .where(eq(authSchema.session.id, session.id));

    const subdomain = `regression-tenant-${unique}`;
    const tenant = await seedTenant({
      subdomain,
      name: "Regression Tenant",
      accountId: `${subdomain}.testnet`,
      orgId: orgA.id,
    });

    const cookiesResolved = path.resolve(process.cwd(), MEMBER_COOKIES_PATH);
    fs.mkdirSync(path.dirname(cookiesResolved), { recursive: true });
    fs.writeFileSync(cookiesResolved, JSON.stringify(cookies, null, 2));
    console.log(`[member-seed] wrote ${cookiesResolved}`);

    const seedResolved = path.resolve(process.cwd(), MEMBER_SEED_PATH);
    fs.writeFileSync(
      seedResolved,
      JSON.stringify(
        {
          orgAID: orgA.id,
          orgBID: orgB.id,
          orgAName,
          orgBName,
          tenantID: tenant.id,
          subdomain: tenant.subdomain,
        },
        null,
        2,
      ),
    );
    console.log(`[member-seed] wrote ${seedResolved}`);
  } finally {
    await close();
  }
}
