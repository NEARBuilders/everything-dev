import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

// dev:ssr's smoke tier loads zero SSR'd pages today — it runs the identical
// two client-side specs as dev:csr (plan 052 item 11). This spec gives the
// SSR tier its one page: the root is server-rendered (landing content is in
// the DOM) and hydrates without a hydration failure — the browser-side
// counterpart the Go suite's raw-HTML gate cannot check.
test("root hydrates from server-rendered landing content", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  await expect(page.getByTestId("landing-steps")).toBeVisible();
  expectNoHydrationFailure(errors);
  expect(errors).toEqual([]);
});
