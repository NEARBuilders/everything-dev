import { expect, type Page } from "@playwright/test";

export type PageErrors = string[];

const HYDRATION_PATTERNS = [
  "[Hydrate] Failed:",
  "Cannot read properties of undefined (reading 'call')",
  "Text content did not match",
  "Hydration failed because the initial UI",
  // React 19 wording — e.g. "the server rendered text didn't match the client".
  "Hydration failed because the server rendered",
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

const CSP_CONSOLE_RE = /Refused to (?:execute|load)|Content Security Policy/i;

/** A violated CSP means scripts were blocked — every later wait is doomed to
 * the full timeout, and the useful signal is in the violation, not the
 * timeout. Races the pending wait against the first violation. */
async function waitForAppOrCspBlock(page: Page): Promise<void> {
  const violations: string[] = [];
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === "error" && CSP_CONSOLE_RE.test(msg.text())) {
      violations.push(msg.text());
    }
  };
  page.on("console", onConsole);
  try {
    await Promise.race([
      page.waitForFunction(
        () =>
          typeof (window as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__ !== "undefined",
        undefined,
        { timeout: 30000 },
      ),
      new Promise<never>((_, reject) => {
        const poll = setInterval(() => {
          if (violations.length > 0) {
            clearInterval(poll);
            reject(
              new Error(
                `scripts were blocked by the response's Content-Security-Policy — head/nonce liveness broke (first violation: ${violations[0]})`,
              ),
            );
          }
        }, 250);
      }),
    ]);
  } finally {
    page.off("console", onConsole);
  }
}

export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector("#root", { timeout: 30000 });
  await waitForAppOrCspBlock(page);

  try {
    await page.waitForFunction(
      () => {
        const p = (window as { __EVERYTHING_DEV_HYDRATE_PROMISE__?: Promise<void> })
          .__EVERYTHING_DEV_HYDRATE_PROMISE__;
        return p !== undefined;
      },
      { timeout: 5000 },
    );
    await page.evaluate(async () => {
      const p = (window as { __EVERYTHING_DEV_HYDRATE_PROMISE__?: Promise<void> })
        .__EVERYTHING_DEV_HYDRATE_PROMISE__;
      if (p) await p;
    });
  } catch {
    // Hydration promise never surfaced (e.g. client-shell fallback path) — proceed.
  }
}

export function expectNoHydrationFailure(errors: PageErrors) {
  const joined = errors.join("\n");
  for (const pattern of HYDRATION_PATTERNS) {
    expect(joined, `Found hydration error matching: ${pattern}`).not.toContain(pattern);
  }
}
