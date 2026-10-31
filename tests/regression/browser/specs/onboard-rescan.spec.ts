import { expect, type Page, test } from "@playwright/test";
import {
  type CookieJar,
  createOrganization,
  getSessionBetterAuth,
  newAnonymousSession,
  postBetterAuth,
  postRpc,
} from "../../lib/http-seed.mjs";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { collectErrors } from "../helpers/page-ready";

/**
 * The onboarding rescan journey (ADR 0038 addendum): the stack database is
 * in-process pglite, so every fixture is minted over the public API surface —
 * anonymous sign-ins, org creation + approval through the admin routes, and
 * the "member removed but stale active-org" state produced by the organizer
 * removing the joiner (`removeMember` leaves the removed user's session
 * untouched, which is exactly the state the rescan must recover from).
 */
const regressionEnv = computeRegressionEnv();

function cookieHeader(cookies: Array<{ name: string; value: string }>) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function rpcGetSession(jar: CookieJar) {
  const response = await fetch(`${regressionEnv.baseUrl}/api/rpc/auth/getSession`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar.playwrightCookies()) },
    body: JSON.stringify({ json: {} }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/rpc/auth/getSession failed: ${response.status}`);
  }
  const { json } = (await response.json()) as {
    json: { session: { activeOrganizationId: string | null } | null };
  };
  return json;
}

async function removeMemberAsOrganizer(organizer: CookieJar, joinerEmail: string, orgId: string) {
  const response = await fetch(`${regressionEnv.baseUrl}/api/rpc/auth/removeMember`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(organizer.playwrightCookies()),
    },
    body: JSON.stringify({
      json: { memberIdOrEmail: joinerEmail, organizationId: orgId },
    }),
  });
  if (!response.ok) {
    throw new Error(`removeMember failed: ${response.status} ${await response.text()}`);
  }
}

async function createOnboardingCode(organizer: CookieJar, org: { id: string }, unique: string) {
  const response = await fetch(`${regressionEnv.baseUrl}/api/rpc/auth/createOnboardingCode`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(organizer.playwrightCookies()),
    },
    body: JSON.stringify({
      json: {
        eventId: `rescan-${unique}`,
        eventName: "Rescan Night",
        organizationId: org.id,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`createOnboardingCode failed: ${response.status} ${await response.text()}`);
  }
  const { json } = (await response.json()) as { json: { code: string } };
  return json.code;
}

async function addSessionCookies(page: Page, jar: CookieJar) {
  await page.context().addCookies(jar.playwrightCookies());
}

test.describe("onboard rescan", () => {
  test("a member who left is told so on rescan, not that they rejoined", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const unique = `${process.pid}-${Date.now()}`;

    const organizerJar = await newAnonymousSession(regressionEnv, "Onboard Organizer");
    const org = await createOrganization(regressionEnv, organizerJar, `onboard-rescan-${unique}`);
    await postRpc(regressionEnv, "auth/reviewOrganization", {
      organizationId: org.id,
      decision: "approve",
    });
    const code = await createOnboardingCode(organizerJar, org, unique);

    const joinerJar = await newAnonymousSession(regressionEnv, "Rescan Tester");
    const joiner = await getSessionBetterAuth(regressionEnv.baseUrl, joinerJar);
    if (!joiner?.user?.email) {
      throw new Error("joiner session produced no user email");
    }

    await addSessionCookies(page, joinerJar);
    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.continue-on-computer")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId("onboard.success")).toContainText(org.name);

    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.continue-on-computer")).toBeVisible({
      timeout: 20000,
    });

    // Stale state without raw DB writes: point the joiner's session at the
    // org (if the join did not already), then the organizer removes the
    // member — the removed user's session keeps its activeOrganizationId.
    const joinedSession = await rpcGetSession(joinerJar);
    if (joinedSession?.session?.activeOrganizationId !== org.id) {
      await postBetterAuth(regressionEnv.baseUrl, "organization/set-active", {
        jar: joinerJar,
        body: { organizationId: org.id },
      });
    }
    await removeMemberAsOrganizer(organizerJar, joiner.user.email, org.id);

    await page.goto(`/onboard?code=${code}`);
    await expect(page.getByTestId("onboard.left")).toHaveText(
      "You’re no longer a member of this community. Ask an organizer for a new code or an invitation.",
      { timeout: 20000 },
    );
    await expect(page.getByTestId("onboard.success")).toHaveCount(0);

    await expect
      .poll(async () => {
        const session = await rpcGetSession(joinerJar);
        return session?.session?.activeOrganizationId;
      })
      .not.toBe(org.id);

    expect(pageErrors).toEqual([]);
  });
});
