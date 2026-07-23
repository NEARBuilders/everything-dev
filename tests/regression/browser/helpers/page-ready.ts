import { expect, type Page } from "@playwright/test";

export type PageErrors = string[];

const HYDRATION_PATTERNS = [
  "[Hydrate] Failed:",
  "Cannot read properties of undefined (reading 'call')",
  "Text content did not match",
  "Hydration failed because the initial UI",
  "Expected server HTML to contain a matching",
  "did not match server-rendered HTML",
];

export function collectErrors(page: Page): PageErrors {
  const errors: PageErrors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const text = msg.text();
      if (HYDRATION_PATTERNS.some((p) => text.includes(p))) {
        errors.push(`[console.${msg.type()}] ${text}`);
      }
    }
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
  for (const pattern of HYDRATION_PATTERNS) {
    expect(joined, `Found hydration error matching: ${pattern}`).not.toContain(pattern);
  }
}