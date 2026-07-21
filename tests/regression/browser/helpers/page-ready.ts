import { expect, type Page } from "@playwright/test";

export type PageErrors = string[];

export function collectErrors(page: Page): PageErrors {
  const errors: PageErrors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector("#root", { timeout: 30000 });
  const hasRuntimeConfig = await page.evaluate(() => {
    return typeof window.__RUNTIME_CONFIG__ !== "undefined";
  });
  expect(hasRuntimeConfig).toBeTruthy();
}

export function expectNoHydrationFailure(errors: PageErrors) {
  const joined = errors.join("\n");
  expect(joined).not.toContain("[Hydrate] Failed:");
  expect(joined).not.toContain("Cannot read properties of undefined (reading 'call')");
}
