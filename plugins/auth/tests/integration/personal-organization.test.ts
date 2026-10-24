import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestOrg, createTestServices, createTestUser } from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

describe("personal organization", () => {
  it("names the personal organization after the user", async () => {
    const user = await createTestUser(services.services, { name: "Ada Lovelace" });

    const org = await services.services.db.query.organization.findFirst({
      where: eq(schema.organization.slug, user.userId),
    });

    expect(org?.name).toBe("Ada Lovelace");
    expect(org?.metadata).toBe(JSON.stringify({ isPersonal: true }));
  });

  it("falls back to Personal for a nameless user", async () => {
    const email = `nameless-${crypto.randomUUID().slice(0, 8)}@example.com`;
    await services.services.auth.api.signUpEmail({
      body: { email, password: "Test1234!", name: "" },
    });

    const dbUser = await services.services.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    });
    const org = await services.services.db.query.organization.findFirst({
      where: eq(schema.organization.slug, dbUser?.id ?? ""),
    });

    expect(org?.name).toBe("Personal");
  });

  it("activates the personal organization on every new session", async () => {
    const user = await createTestUser(services.services);

    const signUpSessions = await services.services.db.query.session.findMany({
      where: eq(schema.session.userId, user.userId),
    });

    expect(signUpSessions.length).toBeGreaterThan(0);
    for (const session of signUpSessions) {
      expect(session.activeOrganizationId).toBe(user.personalOrgId);
    }
  });

  it("activates the personal organization even with other memberships", async () => {
    const user = await createTestUser(services.services);
    const org = await createTestOrg(services.services, user.userId);
    await services.services.auth.api.signInEmail({
      body: { email: user.email, password: "Test1234!" },
    });

    const memberships = await services.services.db.query.member.findMany({
      where: eq(schema.member.userId, user.userId),
    });
    expect(memberships.length).toBe(2);

    const session = await services.services.db.query.session.findFirst({
      where: eq(schema.session.userId, user.userId),
    });
    expect(session?.activeOrganizationId).toBe(user.personalOrgId);
    expect(session?.activeOrganizationId).not.toBe(org.id);
  });

  it("reports the active personal org in getContext", async () => {
    const user = await createTestUser(services.services);
    const handlers = createTestHandlers(services.services);

    const result = await handlers.session.getContext({
      context: { reqHeaders: user.reqHeaders },
    });

    expect(result.isAuthenticated).toBe(true);
    expect(result.organization.activeOrganizationId).toBe(user.personalOrgId);
    expect(result.organization.organization?.name).toBe(user.name);
    expect(result.organization.isPersonal).toBe(true);
    expect(result.organization.member?.role).toBe("owner");
  });
});
