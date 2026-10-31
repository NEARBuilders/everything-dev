import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as authSchema from "../../../../plugins/auth/src/db/schema.ts";
import { createAuthTestInstance } from "../../lib/auth-test-instance.ts";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { collectErrors } from "../helpers/page-ready";

type Fixtures = Awaited<ReturnType<typeof createAuthTestInstance>>;

const regressionEnv = computeRegressionEnv();

function cookieHeader(cookies: Array<{ name: string; value: string }>) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function createCode(fixtures: Fixtures, unique: string) {
  const organizer = await fixtures.test.saveUser(
    fixtures.test.createUser({
      email: `onboard-organizer-${unique}@regression.test`,
      name: "Onboard Organizer",
      emailVerified: true,
    }),
  );
  const orgName = `onboard-rescan-${unique}`;
  const org = await fixtures.test.saveOrganization(
    fixtures.test.createOrganization({ name: orgName, slug: orgName }),
  );
  await fixtures.test.addMember({ userId: organizer.id, organizationId: org.id, role: "owner" });
  const cookies = await fixtures.test.getCookies({ userId: organizer.id, domain: "localhost" });

  const response = await fetch(`${regressionEnv.baseUrl}/api/rpc/auth/createOnboardingCode`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(cookies) },
    body: JSON.stringify({
      json: { eventId: `rescan-${unique}`, eventName: "Rescan Night", organizationId: org.id },
    }),
  });
  if (!response.ok) {
    throw new Error(`createOnboardingCode failed: ${response.status} ${await response.text()}`);
  }
  const { json } = (await response.json()) as { json: { code: string } };
  return { org, code: json.code };
}

test.describe("onboard rescan", () => {
  let fixtures: Fixtures;

  test.beforeAll(async () => {
    fixtures = await createAuthTestInstance({
      authDatabaseUrl: regressionEnv.dbUrls.AUTH_DATABASE_URL ?? "",
      secret: regressionEnv.authSecret,
    });
  });

  test.afterAll(async () => {
    await fixtures.close();
  });

  test("a member who left is told so on rescan, not that they rejoined", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const unique = `${process.pid}-${Date.now()}`;
    const { org, code } = await createCode(fixtures, unique);

    const joiner = await fixtures.test.saveUser(
      fixtures.test.createUser({
        email: `onboard-joiner-${unique}@regression.test`,
        name: "Rescan Tester",
        emailVerified: true,
      }),
    );
    await page
      .context()
      .addCookies(await fixtures.test.getCookies({ userId: joiner.id, domain: "localhost" }));

    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.continue-on-computer")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId("onboard.success")).toContainText(org.name);

    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.continue-on-computer")).toBeVisible({
      timeout: 20000,
    });

    await fixtures.db
      .delete(authSchema.member)
      .where(
        and(eq(authSchema.member.userId, joiner.id), eq(authSchema.member.organizationId, org.id)),
      );
    await fixtures.db
      .update(authSchema.session)
      .set({ activeOrganizationId: org.id })
      .where(eq(authSchema.session.userId, joiner.id));

    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.left")).toHaveText(
      "You’re no longer a member of this community. Ask an organizer for a new code or an invitation.",
      { timeout: 20000 },
    );
    await expect(page.getByTestId("onboard.success")).toHaveCount(0);

    await expect
      .poll(async () => {
        const sessions = await fixtures.db.query.session.findMany({
          where: eq(authSchema.session.userId, joiner.id),
        });
        return sessions.map((session) => session.activeOrganizationId);
      })
      .not.toContain(org.id);

    expect(pageErrors).toEqual([]);
  });
});
