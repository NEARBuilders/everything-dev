import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { computeRegressionEnv } from "../../lib/regression-env.mjs";
import { waitForApp } from "./page-ready";

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface SeedData {
  orgAID: string;
  orgBID: string;
  orgAName: string;
  orgBName: string;
  tenantID: string;
  subdomain: string;
}

const COOKIES_PATH = ".bos/regression/cookies.json";
const ADMIN_COOKIES_PATH = ".bos/regression/admin-cookies.json";
const LOGOUT_COOKIES_PATH = ".bos/regression/logout-cookies.json";
const SEED_PATH = ".bos/regression/seed.json";
const ADMIN_SEED_PATH = ".bos/regression/admin-seed.json";

interface AdminSeedData {
  adminName: string;
  logoutName: string;
  orgAName: string;
  orgBName: string;
}

function readJsonFile(filePath: string) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Seed file not found: ${resolved}. Run Go HTTP regression tests first.`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf-8"));
}

export async function injectCookies(page: Page) {
  const cookies: CookieEntry[] = readJsonFile(COOKIES_PATH);
  await page.context().addCookies(cookies);
}

export async function seedRegressionThing() {
  const { baseUrl } = computeRegressionEnv();
  const cookies: CookieEntry[] = readJsonFile(COOKIES_PATH);
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const response = await fetch(`${baseUrl}/api/things`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({
      thingId: "regression-plugin-test",
      payload: { kind: "regression", source: "plugin-passthrough" },
    }),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`seeding regression thing failed: ${response.status} ${await response.text()}`);
  }
}

export async function injectAdminCookies(page: Page) {
  const cookies: CookieEntry[] = readJsonFile(ADMIN_COOKIES_PATH);
  await page.context().addCookies(cookies);
}

export async function injectLogoutCookies(page: Page) {
  const cookies: CookieEntry[] = readJsonFile(LOGOUT_COOKIES_PATH);
  await page.context().addCookies(cookies);
}

export function loadSeedData(): SeedData {
  return readJsonFile(SEED_PATH) as SeedData;
}

export function loadAdminSeedData(): AdminSeedData {
  return readJsonFile(ADMIN_SEED_PATH) as AdminSeedData;
}

export async function verifyAuthenticated(page: Page) {
  const sessionResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/auth/get-session") && response.status() === 200) {
      sessionResponses.push(response.url());
    }
  });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await waitForApp(page);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000, waitUntil: "commit" });
  expect(sessionResponses.length, "expected a resolved auth session").toBeGreaterThanOrEqual(1);
}
