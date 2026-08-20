import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

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
const SEED_PATH = ".bos/regression/seed.json";

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

export function loadSeedData(): SeedData {
  return readJsonFile(SEED_PATH) as SeedData;
}

export async function verifyAuthenticated(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("button[title='account menu']")).toBeVisible({ timeout: 10000 });
}
