import { expect, test } from "@playwright/test";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { seedNode, seedTenant } from "../../lib/seed-tenant.mjs";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectAdminCookies, loadAdminSeedData } from "../helpers/seeded";

const { baseUrl } = computeRegressionEnv();

test.use({ trace: "on" });

test.describe("node page propose homepage CTA", () => {
  let ownedNode: Awaited<ReturnType<typeof seedNode>>;
  let unrelatedNode: Awaited<ReturnType<typeof seedNode>>;
  let orgSlug: string;

  test.beforeAll(async ({ browser }) => {
    const { orgAName } = loadAdminSeedData();
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();
    await injectAdminCookies(page);
    const response = await page.request.get("/api/auth/organization/list");
    expect(response.ok(), await response.text()).toBe(true);
    const organizations = (await response.json()) as { id: string; name: string; slug: string }[];
    const orgA = organizations.find((org) => org.name === orgAName || org.slug === orgAName);
    if (!orgA) throw new Error(`admin organization ${orgAName} not found`);
    orgSlug = orgA.slug;
    await context.close();

    const unique = `${process.pid}-${Date.now().toString(36)}`;
    const ownedTenant = await seedTenant({
      subdomain: `homepage-cta-${unique}`,
      name: `Homepage CTA ${unique}`,
      accountId: `homepage-cta-${unique}.sputnik-dao.near`,
      orgId: orgA.id,
      ownerKind: "dao",
    });
    ownedNode = await seedNode({
      tenantId: ownedTenant.id,
      slug: `homepage-cta-${unique}`,
      name: `Homepage CTA ${unique}`,
    });
    const unrelatedTenant = await seedTenant({
      subdomain: `homepage-cta-other-${unique}`,
      name: `Homepage CTA Other ${unique}`,
      accountId: `homepage-cta-other-${unique}.sputnik-dao.near`,
      orgId: `homepage-cta-other-org-${unique}`,
      ownerKind: "dao",
    });
    unrelatedNode = await seedNode({
      tenantId: unrelatedTenant.id,
      slug: `homepage-cta-other-${unique}`,
      name: `Homepage CTA Other ${unique}`,
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.route(/(rpc\.(mainnet|testnet)\.|fastnear\.com|near\.org)/, (route) =>
      route.abort(),
    );
  });

  test("signed-out visitors see no propose button", async ({ page }) => {
    const pageErrors = collectErrors(page);

    await page.goto(`/n/${ownedNode.slug}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("node-page.header")).toBeVisible();
    await expect(page.getByTestId("node-page.propose-homepage")).toHaveCount(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("members of an unrelated organization see no propose button", async ({ page }) => {
    const pageErrors = collectErrors(page);
    await injectAdminCookies(page);

    await page.goto(`/n/${unrelatedNode.slug}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("node-page.header")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("node-page.propose-homepage")).toHaveCount(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("owning organization members open the homepage tab from the button", async ({ page }) => {
    const pageErrors = collectErrors(page);
    await injectAdminCookies(page);

    await page.goto(`/n/${ownedNode.slug}`, { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const button = page.getByTestId("node-page.propose-homepage");
    await expect(button).toBeVisible({ timeout: 15000 });
    await button.click();

    await expect(page).toHaveURL(new RegExp(`/orgs/${orgSlug}\\?tab=homepage`), {
      timeout: 15000,
      waitUntil: "commit",
    });
    await expect(page.getByTestId("orgs-tab-homepage")).toHaveAttribute("aria-selected", "true");
    expectNoHydrationFailure(pageErrors);
  });
});
