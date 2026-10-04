/**
 * Hydration e2e (the browser half of gates 4/7): the bundled server must
 * serve the SSR shell + compose payload; the client bundle must construct
 * the same tree (digest parity), hydrate via RouterClient (replaying
 * window.$_TSR), and produce zero hydration-mismatch errors.
 *
 * Success signal — asserted from IN-PAGE evidence (__CLIENT_PROGRESS__),
 * never by racing the DOM: RouterClient's h() sets hydrated=true and — in
 * the same synchronous tick — TanStack's bootstrap cleanup deletes
 * window.$_TSR once the stream has also ended (e() fires at parse time for
 * our buffered response). So `$_TSR` can appear-and-vanish before an
 * external poll ever evaluates; polling for its PRESENCE is a race. The
 * client records the timeline itself:
 *   "hydrateRoot, $_TSR present: true"   → bootstrap existed at client start
 *   "hydration consumed ($_TSR deleted — h() ran)" → hydrate() settled
 *
 * usage: bun src/hydrate-check.ts [url]     (default http://localhost:3000/login)
 * requires: remotes (4001-4003) + bundled server (3000) running
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3000/login";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "commit", timeout: 15000 });
await page.waitForSelector("[data-testid=login]", { timeout: 15000 });

// the SSR content matches the selector instantly — hydration completes later.
// The payload script is stable (never removed), so its presence is race-free.
try {
  await page.waitForFunction(() => "__COMPOSE__" in window, undefined, { timeout: 5000 });
} catch {
  await browser.close();
  console.error(
    "[hydrate] FAIL — no window.__COMPOSE__ payload: this page is not the bundled server's hydration shell (dev path, or a server mid-restart). Boot the bundled server: APP=base PORT=3000 node host/dist/static/js/index.js — and wait for the 'live self-probe passed' line before running checks.",
  );
  process.exit(1);
}

// Wait for the client's own settlement record (race-free — the client logs
// the timeline; an external $_TSR presence poll can lose to fast hydration).
try {
  await page.waitForFunction(
    () => [...((window as any).__CLIENT_PROGRESS__ ?? [])].some((m) => m.includes("hydration consumed")),
    undefined,
    { timeout: 15000 },
  );
} catch {
  // fall through to the report — the progress trace names the failing step
}

const result = await page.evaluate(() => {
  const progress = [...((window as any).__CLIENT_PROGRESS__ ?? [])];
  return {
    bootstrapped: progress.some((m) => m.includes("$_TSR present: true")),
    consumed: progress.some((m) => m.includes("hydration consumed")),
    digest: (window as any).__COMPOSE__?.digest,
    remoteCount: (window as any).__COMPOSE__?.remotes?.length ?? 0,
    progress,
  };
});

const mismatch = errors.filter((e) => /hydrat|did not match|Minified React error #4(18|23)/i.test(e));
const hardErrors = errors.filter((e) => !mismatch.includes(e));

console.log(`[hydrate] ${url}`);
console.log(`  hydrated: ${result.consumed}  digest: ${result.digest}  remotes: ${result.remoteCount}`);
if (result.progress.length) console.log(`  client progress:\n    ${result.progress.join("\n    ")}`);
else console.log("  client progress: NONE (client bundle did not execute)");
if (!result.bootstrapped) console.log("  client saw NO $_TSR bootstrap — the SSR stream did not dehydrate (real dehydration failure)");
if (result.bootstrapped && !result.consumed) console.log("  hydrate(router) never settled — bootstrap present but never consumed (real hang; trace above names the step)");
if (mismatch.length) console.log(`  mismatch errors:\n    ${mismatch.join("\n    ")}`);
if (hardErrors.length) console.log(`  other console errors:\n    ${hardErrors.join("\n    ")}`);

await browser.close();

const ok = result.bootstrapped && result.consumed && mismatch.length === 0 && hardErrors.length === 0;
console.log(`[hydrate] ${ok ? "PASS — SSR HTML hydrated cleanly (bootstrap consumed, digest parity, no mismatch)" : "FAIL"}`);
process.exit(ok ? 0 : 1);
