import fs from "node:fs";
import path from "node:path";
import { computeRegressionEnv } from "./regression-env.mjs";

/**
 * HTTP seeding for the regression stacks (ADR 0038 addendum).
 *
 * The stack database is in-process pglite, so fixture helpers can no longer
 * write rows directly — every seed action goes through the public API surface:
 * `sign-in/anonymous` mints sessions, Better Auth organization routes create
 * the orgs, and two admin routes (`reviewOrganization`, `adminSetRole`) act
 * with the boot-time bootstrap admin API key (AUTH_BOOTSTRAP_ADMIN_API_KEY).
 *
 * The artifacts match the direct-DB era byte-for-byte: `cookies.json`,
 * `admin-cookies.json`, `logout-cookies.json` (Playwright cookie snaps) plus
 * `admin-seed.json` / `seed.json` metadata.
 */

const MEMBER_NAME = "member.near";

function uniqueSuffix() {
  return `${process.pid}`;
}

function originOf(baseUrl) {
  return new URL(baseUrl).origin;
}

function entryFromSetCookie(line, baseUrl) {
  const [pair, ...attributes] = line.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  if (!name) return null;

  const cookie = { name, value };
  let domain;
  let path;
  for (const attribute of attributes) {
    if (/^domain=/i.test(attribute)) {
      domain = attribute.slice(7).trim();
    } else if (/^path=/i.test(attribute)) {
      path = attribute.slice(5).trim();
    } else if (/^secure$/i.test(attribute)) {
      cookie.secure = true;
    } else if (/^httponly$/i.test(attribute)) {
      cookie.httpOnly = true;
    } else if (/^samesite=/i.test(attribute)) {
      const raw = attribute.slice(9).trim().toLowerCase();
      cookie.sameSite = raw === "none" ? "None" : raw === "strict" ? "Strict" : "Lax";
    }
  }
  if (domain) {
    cookie.domain = domain;
  }
  cookie.url ??= baseUrl;
  cookie.path ??= path ?? "/";
  cookie.httpOnly ??= false;
  cookie.secure ??= false;
  cookie.sameSite ??= "Lax";
  return cookie;
}

/**
 * Playwright `context.addCookies` entry shape — the `.json` cookie snaps the
 * specs consume via `injectCookies`.
 */

class CookieJar {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.entries = new Map();
  }

  absorb(response) {
    const lines =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const line of lines) {
      const entry = entryFromSetCookie(line, this.baseUrl);
      if (entry) this.entries.set(entry.name, entry);
    }
  }

  header() {
    return [...this.entries.values()].map((entry) => `${entry.name}=${entry.value}`).join("; ");
  }

  playwrightCookies() {
    const hostname = new URL(this.baseUrl).hostname;
    return [...this.entries.values()].map(({ url: _url, ...entry }) => ({
      ...entry,
      domain: entry.domain ?? hostname,
    }));
  }
}

async function postBetterAuth(baseUrl, path, { jar, body, headers } = {}) {
  const response = await fetch(`${baseUrl}/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: originOf(baseUrl),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : { body: JSON.stringify({}) }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/auth/${path} failed: ${response.status} ${await response.text()}`);
  }
  jar?.absorb(response);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function postRpc(env, procedure, body, extraHeaders = {}) {
  const response = await fetch(`${env.baseUrl}/api/rpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: originOf(env.baseUrl),
      "x-api-key": env.bootstrapAdminKey,
      ...extraHeaders,
    },
    body: JSON.stringify({ json: body }),
  });
  if (!response.ok) {
    throw new Error(
      `POST /api/rpc/${procedure} failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getSessionBetterAuth(baseUrl, jar) {
  const response = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: {
      origin: originOf(baseUrl),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `GET /api/auth/get-session failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

async function newAnonymousSession(env, name) {
  const jar = new CookieJar(env.baseUrl);
  await postBetterAuth(env.baseUrl, "sign-in/anonymous", { jar });
  await postBetterAuth(env.baseUrl, "update-user", {
    jar,
    body: { name },
  });
  return jar;
}

async function createOrganization(env, jar, name) {
  const result = await postBetterAuth(env.baseUrl, "organization/create", {
    jar,
    body: { name, slug: name },
    headers: { origin: originOf(env.baseUrl) },
  });
  if (!result?.id) throw new Error(`organization/create returned no id: ${JSON.stringify(result)}`);
  return result;
}

export async function seedRegressionFixtures({ log = () => {} } = {}) {
  const env = computeRegressionEnv();
  const unique = uniqueSuffix();

  const adminJar = await newAnonymousSession(env, `regression-admin-${unique}`);
  const logoutJar = await newAnonymousSession(env, "logout.near");
  const memberJar = await newAnonymousSession(env, MEMBER_NAME);

  const adminUser = await getSessionBetterAuth(env.baseUrl, adminJar);
  const memberUser = await getSessionBetterAuth(env.baseUrl, memberJar);
  if (!adminUser?.user?.id || !memberUser?.user?.id) {
    throw new Error("anonymous sign-in produced no session user");
  }

  await postRpc(env, "auth/adminSetRole", { userId: adminUser.user.id, role: "admin" });

  const adminOrgAName = `regression-admin-org-a-${unique}`;
  const adminOrgBName = `regression-admin-org-b-${unique}`;
  const adminOrgA = await createOrganization(env, adminJar, adminOrgAName);
  const adminOrgB = await createOrganization(env, adminJar, adminOrgBName);

  const orgAName = `regression-org-a-${unique}`;
  const orgBName = `regression-org-b-${unique}`;
  const memberOrgA = await createOrganization(env, memberJar, orgAName);
  const memberOrgB = await createOrganization(env, memberJar, orgBName);

  for (const orgId of [adminOrgA.id, adminOrgB.id, memberOrgA.id, memberOrgB.id]) {
    await postRpc(env, "auth/reviewOrganization", { organizationId: orgId, decision: "approve" });
  }

  await postBetterAuth(env.baseUrl, "organization/set-active", {
    jar: memberJar,
    body: { organizationId: memberOrgA.id },
  });

  const writeFile = (relativePath, value) => {
    const resolved = path.resolve(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(value, null, 2));
    log(`[http-seed] wrote ${relativePath}`);
  };

  writeFile(".bos/regression/cookies.json", memberJar.playwrightCookies());
  writeFile(".bos/regression/admin-cookies.json", adminJar.playwrightCookies());
  writeFile(".bos/regression/logout-cookies.json", logoutJar.playwrightCookies());
  writeFile(".bos/regression/admin-seed.json", {
    adminName: `regression-admin-${unique}`,
    logoutName: "logout.near",
    orgAName: adminOrgAName,
    orgBName: adminOrgBName,
  });
  writeFile(".bos/regression/seed.json", {
    orgAID: memberOrgA.id,
    orgBID: memberOrgB.id,
    orgAName,
    orgBName,
  });

  return { env, adminJar, memberJar, logoutJar };
}
