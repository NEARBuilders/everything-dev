import { expect, type Page, test } from "@playwright/test";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { seedNode, seedTenant } from "../../lib/seed-tenant.mjs";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies, loadSeedData, seedDiscoveryNode } from "../helpers/seeded";

const { baseUrl } = computeRegressionEnv();

async function setActiveOrganization(page: Page, organizationId: string | null) {
  await injectCookies(page);
  const response = await page.request.post("/api/auth/organization/set-active", {
    data: { organizationId },
    headers: { origin: baseUrl },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe("stake community scope", () => {
  let connectedNode: Awaited<ReturnType<typeof seedNode>>;
  let unrelatedNode: Awaited<ReturnType<typeof seedNode>>;

  test.beforeAll(async () => {
    const { orgBID } = loadSeedData();
    const unique = `${process.pid}-${Date.now().toString(36)}`;

    await seedDiscoveryNode({
      slug: `stake-active-${unique}`,
      name: `Stake Active ${unique}`,
    });
    const connectedTenant = await seedTenant({
      subdomain: `stake-connected-${unique}`,
      name: `Stake Connected ${unique}`,
      accountId: `stake-connected-${unique}.testnet`,
      orgId: orgBID,
    });
    connectedNode = await seedNode({
      tenantId: connectedTenant.id,
      slug: `stake-connected-${unique}`,
      name: `Stake Connected ${unique}`,
    });
    const unrelatedTenant = await seedTenant({
      subdomain: `stake-unrelated-${unique}`,
      name: `Stake Unrelated ${unique}`,
      accountId: `stake-unrelated-${unique}.testnet`,
      orgId: `stake-unrelated-org-${unique}`,
    });
    unrelatedNode = await seedNode({
      tenantId: unrelatedTenant.id,
      slug: `stake-unrelated-${unique}`,
      name: `Stake Unrelated ${unique}`,
    });
  });

  test.afterEach(async ({ page }) => {
    const { orgAID } = loadSeedData();
    await setActiveOrganization(page, orgAID);
  });

  test("defaults an active organization to its community", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const { orgAID } = loadSeedData();
    await setActiveOrganization(page, orgAID);

    await page.goto("/stake", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    await expect(page.getByTestId("stake.heading")).toContainText("Stake to ");
    await expect(page.getByTestId("stake.directory")).toHaveCount(0);
    await expect(page.getByTestId(`stake.community-${connectedNode.slug}`)).toHaveCount(0);
    await expect(page.getByTestId(`stake.community-${unrelatedNode.slug}`)).toHaveCount(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("shows only connected communities without an active organization", async ({ page }) => {
    const pageErrors = collectErrors(page);
    await setActiveOrganization(page, null);

    await page.goto("/stake", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const directory = page.getByTestId("stake.directory");
    await expect(directory).toContainText("Regression Tenant");
    await expect(directory.getByTestId(`stake.community-${connectedNode.slug}`)).toBeVisible();
    await expect(directory.getByTestId(`stake.community-${unrelatedNode.slug}`)).toHaveCount(0);
    expectNoHydrationFailure(pageErrors);
  });

  test("keeps the full public directory for signed-out visitors", async ({ page }) => {
    const pageErrors = collectErrors(page);

    await page.goto("/stake", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const directory = page.getByTestId("stake.directory");
    await expect(directory).toContainText("Regression Tenant");
    await expect(directory.getByTestId(`stake.community-${connectedNode.slug}`)).toBeVisible();
    await expect(directory.getByTestId(`stake.community-${unrelatedNode.slug}`)).toBeVisible();
    expectNoHydrationFailure(pageErrors);
  });
});
