import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies, seedDiscoveryNode } from "../helpers/seeded";

test.describe("discovery profile save → Explore", () => {
  test("saving with Show on Explore publishes the community to list and map", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const node = await seedDiscoveryNode({
      name: `Karachi Explore ${Date.now().toString(36)}`,
    });

    await injectCookies(page);
    await page.goto(`/nodes/${node.id}/content?tab=profile`, {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);

    await expect(page.getByTestId("content.heading")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("discovery-profile-form")).toBeVisible({ timeout: 15000 });

    const published = page.getByTestId("discovery-profile-published");
    await published.click();
    await expect(published).toHaveAttribute("data-checked", "", { timeout: 5000 });

    await page
      .getByTestId("discovery-profile-summary")
      .fill("A community by the sea for builders.");
    await page.getByTestId("discovery-profile-location").fill("Karachi");
    await page.getByTestId("discovery-profile-region").fill("Pakistan");

    await page.getByTestId("discovery-profile-add-channel").click();
    await page.getByTestId("discovery-profile-channel-label-0").fill("Community");
    await page.getByTestId("discovery-profile-channel-url-0").fill("https://example.com/community");

    await page.getByTestId("discovery-profile-save").click();
    await expect(page.getByText("Profile saved and live on Explore")).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/explore?view=list", { waitUntil: "domcontentloaded" });
    await waitForApp(page);
    await expect(page.getByTestId("explore.heading")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`discovery-node-${node.id}`)).toBeVisible({ timeout: 15000 });

    await page.getByTestId("explore-view-map").click();
    await expect(page.getByTestId(`discovery-node-${node.id}`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`discovery-map-marker-${node.id}`)).toBeVisible({
      timeout: 20000,
    });

    expectNoHydrationFailure(pageErrors);
  });
});
