import { expect, type Page, test } from "@playwright/test";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

const { baseUrl } = computeRegressionEnv();

// A wedged server endpoint must fail the test with a named error instead of
// hanging the suite for minutes — every regression fetch carries a deadline.
const FETCH_TIMEOUT_MS = 15_000;

async function authFetch(path: string, cookie: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function signInAnonymously() {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`anonymous sign-in failed: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * Production enables better-auth's session cookie cache: the `session_data`
 * cookie is a snapshot from the last fresh session read, so server-side
 * mutations made OUT OF BAND (this fixture's raw accept-invitation, not the
 * app's synchronize path) are invisible for the 5-minute cache window. A
 * cache-disabled get-session re-reads the DB and refreshes the cache cookie —
 * merge its Set-Cookie pairs over the jar like a real cookie jar: same-name
 * replaces, an empty-valued pair deletes, and the rest (the session token —
 * which the refresh does not re-issue) survives.
 */
async function refreshSessionCookies(cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/get-session?disableCookieCache=true`, {
    headers: { cookie, origin: baseUrl },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`session refresh failed: ${response.status}`);

  const jar = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair]));
  for (const pair of response.headers.getSetCookie().map((value) => value.split(";")[0])) {
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (value.length === 0) jar.delete(name);
    else jar.set(name, pair);
  }
  const merged = [...jar.values()].join("; ");
  if (
    !merged.includes("better-auth.session_token=") &&
    !merged.includes("__Secure-better-auth.session_token=")
  ) {
    throw new Error(`refreshed cookie set lost the session token: ${merged.slice(0, 200)}`);
  }
  return merged;
}

async function seedTeamMember() {
  const suffix = `${process.pid}-${Date.now()}`;
  const ownerCookie = await signInAnonymously();
  const org = await (
    await authFetch("/organization/create", ownerCookie, {
      name: `team-workspace-${suffix}`,
      slug: `team-workspace-${suffix}`,
    })
  ).json();
  const team = await (
    await authFetch("/organization/create-team", ownerCookie, {
      name: "Stake Desk",
      organizationId: org.id,
      metadata: JSON.stringify({ areas: ["stake"] }),
    })
  ).json();

  const memberCookie = await signInAnonymously();
  const session = await (await authFetch("/get-session", memberCookie)).json();
  const invitation = await (
    await authFetch("/organization/invite-member", ownerCookie, {
      email: session.user.email,
      role: "member",
      organizationId: org.id,
      teamId: team.id,
    })
  ).json();
  await authFetch("/organization/accept-invitation", memberCookie, {
    invitationId: invitation.id,
  });
  return { memberCookie: await refreshSessionCookies(memberCookie), teamName: team.name as string };
}

async function useCookieHeader(page: Page, cookieHeader: string) {
  const url = new URL(baseUrl);
  await page.context().addCookies(
    cookieHeader.split("; ").map((pair) => {
      const index = pair.indexOf("=");
      return {
        name: pair.slice(0, index),
        value: pair.slice(index + 1),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax" as const,
      };
    }),
  );
}

test.describe("team workspace", () => {
  test("team membership, rename and deletion refresh the mounted workspace", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const ownerCookie = await signInAnonymously();
    const session = await (await authFetch("/get-session", ownerCookie)).json();
    const suffix = `${process.pid}-${Date.now()}`;
    const org = await (
      await authFetch("/organization/create", ownerCookie, {
        name: `workspace-refresh-${suffix}`,
        slug: `workspace-refresh-${suffix}`,
      })
    ).json();
    const team = await (
      await authFetch("/organization/create-team", ownerCookie, {
        name: "Finance",
        organizationId: org.id,
        metadata: JSON.stringify({ areas: ["finance"] }),
      })
    ).json();
    await authFetch("/organization/set-active", ownerCookie, { organizationId: org.id });
    await useCookieHeader(page, ownerCookie);
    await page.goto(`/orgs/${org.slug}?tab=teams`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("orgs-tab-teams")).toHaveAttribute("aria-selected", "true");

    const addMember = async () => {
      await page.getByTestId(`teams-tab-add-member-${team.id}`).click();
      await page.getByTestId(`teams-tab-add-member-option-${team.id}-${session.user.id}`).click();
      await page.getByTestId(`teams-tab-add-member-button-${team.id}`).click();
      await expect(page.getByTestId("team-switcher")).toBeVisible();
      await page.getByTestId("team-switcher").click();
      await page.getByTestId(`team-switcher-item-${team.id}`).click();
      await expect(page.getByTestId("workspace-active-team")).toBeVisible();
    };
    await addMember();
    await page.getByTestId(`teams-tab-menu-${team.id}`).click();
    await page.getByTestId(`teams-tab-rename-${team.id}`).click();
    await page.getByTestId(`teams-tab-rename-input-${team.id}`).fill("Treasury");
    await page.getByTestId(`teams-tab-rename-save-${team.id}`).click();
    await expect(page.getByTestId("workspace-active-team")).toContainText("Treasury");
    await expect(page.getByTestId("team-switcher")).toContainText("Treasury");

    await page.getByTestId(`teams-tab-remove-member-${team.id}-${session.user.id}`).click();
    await expect(page.getByTestId("workspace-active-team")).toHaveCount(0);
    await expect(page.getByTestId("team-switcher")).toHaveCount(0);
    await expect(page.getByTestId("orgs-tab-teams")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/[?&]tab=teams/);
    await addMember();
    await page.getByTestId(`teams-tab-menu-${team.id}`).click();
    await page.getByTestId(`teams-tab-delete-${team.id}`).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page.getByTestId("workspace-active-team")).toHaveCount(0);
    await expect(page.getByTestId("team-switcher")).toHaveCount(0);
    await expect(page.getByTestId(`teams-tab-team-${team.id}`)).toHaveCount(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("switching teams filters navigation and guards restricted routes", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const { memberCookie, teamName } = await seedTeamMember();
    await useCookieHeader(page, memberCookie);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const switcher = page.getByTestId("team-switcher");
    await expect(switcher).toContainText(teamName, { timeout: 10000 });
    await expect(page.getByTestId("workspace-active-team")).toContainText(teamName);
    await expect(page.getByTestId("sidebar-nav-stake")).toBeVisible();
    await expect(page.getByTestId("sidebar-nav-things")).toHaveCount(0);

    await page.goto("/things", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/dashboard\?restricted=things/, {
      timeout: 10000,
      waitUntil: "commit",
    });
    await expect(page.getByTestId("workspace-restricted-notice")).toBeVisible({ timeout: 10000 });

    await switcher.click();
    await page.getByTestId("team-switcher-item-all").click();
    await expect(switcher).toContainText("All areas", { timeout: 10000 });
    await expect(page.getByTestId("sidebar-nav-things")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("workspace-active-team")).toHaveCount(0);

    await page.getByTestId("sidebar-nav-things").click();
    await page.waitForURL(/\/things/, { timeout: 10000, waitUntil: "commit" });

    expectNoHydrationFailure(pageErrors);
  });
});
