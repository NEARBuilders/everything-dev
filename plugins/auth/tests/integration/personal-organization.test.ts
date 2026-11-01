import { and, eq } from "drizzle-orm";
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

  describe("restore on re-login", () => {
    it("restores the previously active organization", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });

      const remembered = await services.services.db.query.user.findFirst({
        where: eq(schema.user.id, user.userId),
      });
      expect(remembered?.lastActiveOrganizationId).toBe(org.id);

      const relogin = await services.services.auth.api.signInEmail({
        body: { email: user.email, password: "Test1234!" },
      });
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.token, relogin.token),
      });
      expect(session?.activeOrganizationId).toBe(org.id);
    });

    it("restores the remembered team of the remembered organization", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      const team = await handlers.teams.createTeam({
        input: { name: "Restore Crew", organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.teams.addTeamMember({
        input: { teamId: team.id, userId: user.userId, organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.teams.setActiveTeam({
        input: { teamId: team.id },
        context: { reqHeaders: user.reqHeaders },
      });

      const remembered = await services.services.db.query.user.findFirst({
        where: eq(schema.user.id, user.userId),
      });
      expect(remembered?.lastActiveTeamId).toBe(team.id);

      const relogin = await services.services.auth.api.signInEmail({
        body: { email: user.email, password: "Test1234!" },
      });
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.token, relogin.token),
      });
      expect(session?.activeOrganizationId).toBe(org.id);
      expect(session?.activeTeamId).toBe(team.id);
    });

    it("falls back to the personal org when membership in the remembered org is revoked", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await services.services.db
        .delete(schema.member)
        .where(
          and(eq(schema.member.userId, user.userId), eq(schema.member.organizationId, org.id)),
        );

      const relogin = await services.services.auth.api.signInEmail({
        body: { email: user.email, password: "Test1234!" },
      });
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.token, relogin.token),
      });
      expect(session?.activeOrganizationId).toBe(user.personalOrgId);
      expect(session?.activeTeamId).toBeNull();
    });

    it("falls back to the personal org when the remembered org is no longer active", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await services.services.db
        .update(schema.organization)
        .set({ status: "pending" })
        .where(eq(schema.organization.id, org.id));

      const relogin = await services.services.auth.api.signInEmail({
        body: { email: user.email, password: "Test1234!" },
      });
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.token, relogin.token),
      });
      expect(session?.activeOrganizationId).toBe(user.personalOrgId);
    });

    it("does not restore a team that belongs to a different organization", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const otherOrg = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      const team = await handlers.teams.createTeam({
        input: { name: "Other Crew", organizationId: otherOrg.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.teams.addTeamMember({
        input: { teamId: team.id, userId: user.userId, organizationId: otherOrg.id },
        context: { reqHeaders: user.reqHeaders },
      });

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.organizations.setActiveOrganization({
        input: { organizationId: otherOrg.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.teams.setActiveTeam({
        input: { teamId: team.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });

      const relogin = await services.services.auth.api.signInEmail({
        body: { email: user.email, password: "Test1234!" },
      });
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.token, relogin.token),
      });
      expect(session?.activeOrganizationId).toBe(org.id);
      expect(session?.activeTeamId).toBeNull();
    });
  });
});
