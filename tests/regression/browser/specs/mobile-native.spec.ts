import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";

test.describe("Mobile native baseline", () => {
  let pageErrors: string[];

  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    pageErrors = collectErrors(page);
  });

  test("viewport meta keeps interactive-widget and viewport-fit", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const content = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    );
    expect(content).toContain("viewport-fit=cover");
    expect(content).toContain("interactive-widget=resizes-content");
  });

  test("platform baseline styles are applied", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForApp(page);

    const styles = await page.evaluate(() => {
      const htmlStyle = getComputedStyle(document.documentElement);
      const button = document.querySelector("button");
      return {
        tapHighlight: htmlStyle.webkitTapHighlightColor,
        overscroll: htmlStyle.overscrollBehavior,
        buttonTouchAction: button ? getComputedStyle(button).touchAction : null,
      };
    });
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(styles.tapHighlight);
    expect(styles.overscroll).toBe("none");
    expect(styles.buttonTouchAction).toBe("manipulation");
  });

  for (const path of ["/", "/about", "/skill"]) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForApp(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      expectNoHydrationFailure(pageErrors);
    });
  }
});
