import { afterEach, describe, expect, it } from "vitest";
import { createTestServices, createTestUser } from "../helpers";

const authOrigin = "http://localhost:3000";

function authRequest(path: string, cookie: string, init?: RequestInit) {
  return new Request(`${authOrigin}/api/auth/${path}`, {
    ...init,
    headers: { cookie, ...init?.headers },
  });
}

describe("session revocation", () => {
  const drivers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const driver of drivers.splice(0)) await driver.close();
  });

  it("revokes another session while retaining the session that requested it", async () => {
    const { services, driver } = await createTestServices();
    drivers.push(driver);
    const firstSession = await createTestUser(services, { email: "sessions@example.com" });
    const secondSignIn = await services.auth.handler(
      new Request(`${authOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: firstSession.email, password: "Test1234!" }),
      }),
    );
    expect(secondSignIn.status).toBe(200);
    const secondCookie = secondSignIn.headers.get("set-cookie") ?? "";
    expect(secondCookie).not.toBe("");

    const beforeRevoke = await services.auth.handler(authRequest("get-session", secondCookie));
    expect(beforeRevoke.status).toBe(200);
    expect(((await beforeRevoke.json()) as { user: { id: string } }).user.id).toBe(
      firstSession.userId,
    );

    const revokeResponse = await services.auth.handler(
      authRequest("revoke-other-sessions", firstSession.cookie, { method: "POST" }),
    );
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toMatchObject({ status: true });

    const currentSession = await services.auth.handler(
      authRequest("get-session", firstSession.cookie),
    );
    expect(currentSession.status).toBe(200);
    expect(((await currentSession.json()) as { user: { id: string } }).user.id).toBe(
      firstSession.userId,
    );

    const revokedSession = await services.auth.handler(authRequest("get-session", secondCookie));
    expect(revokedSession.status).toBe(200);
    expect(await revokedSession.json()).toBeNull();
  });
});
