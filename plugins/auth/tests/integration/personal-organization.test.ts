import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import {
  activateDefaultOrganizationForSession,
  ensurePersonalOrganization,
  findPersonalOrganization,
} from "../../src/personal-organization";
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

  describe("drifted personal organizations", () => {
    const countMemberships = async (userId: string) => {
      const rows = await services.services.db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .innerJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
        .where(eq(schema.member.userId, userId));
      return rows.length;
    };

    it("resolves a metadata-drifted org by slug and does not create a duplicate", async () => {
      const user = await createTestUser(services.services);
      await services.services.db
        .update(schema.organization)
        .set({ metadata: JSON.stringify({ isPersonal: true }, null, 2) })
        .where(eq(schema.organization.id, user.personalOrgId));

      const found = await findPersonalOrganization(services.services.db, user.userId);
      expect(found?.id).toBe(user.personalOrgId);

      const ensured = await ensurePersonalOrganization(services.services.db, {
        id: user.userId,
        name: user.name,
      });
      expect(ensured?.id).toBe(user.personalOrgId);
      expect(await countMemberships(user.userId)).toBe(1);
    });

    it("resolves a slug-drifted org via the metadata flag", async () => {
      const user = await createTestUser(services.services);
      await services.services.db
        .update(schema.organization)
        .set({ slug: `renamed-${crypto.randomUUID().slice(0, 8)}` })
        .where(eq(schema.organization.id, user.personalOrgId));

      const found = await findPersonalOrganization(services.services.db, user.userId);
      expect(found?.id).toBe(user.personalOrgId);

      const ensured = await ensurePersonalOrganization(services.services.db, {
        id: user.userId,
        name: user.name,
      });
      expect(ensured?.id).toBe(user.personalOrgId);
      expect(await countMemberships(user.userId)).toBe(1);
    });

    it("converges existing duplicates on the oldest org", async () => {
      const user = await createTestUser(services.services);
      const driftedId = crypto.randomUUID();
      await services.services.db.insert(schema.organization).values({
        id: driftedId,
        name: "Old Personal",
        slug: `drifted-${crypto.randomUUID().slice(0, 8)}`,
        metadata: '{ "isPersonal": true }',
        createdAt: new Date(Date.now() - 60_000),
      });
      await services.services.db.insert(schema.member).values({
        id: crypto.randomUUID(),
        userId: user.userId,
        organizationId: driftedId,
        role: "owner",
        createdAt: new Date(),
      });

      const found = await findPersonalOrganization(services.services.db, user.userId);
      expect(found?.id).toBe(driftedId);

      const ensured = await ensurePersonalOrganization(services.services.db, {
        id: user.userId,
        name: user.name,
      });
      expect(ensured?.id).toBe(driftedId);
      expect(await countMemberships(user.userId)).toBe(2);
    });

    it("does not match another user's personal organization", async () => {
      const userA = await createTestUser(services.services);
      const userB = await createTestUser(services.services);
      await services.services.db
        .update(schema.organization)
        .set({ slug: `renamed-${crypto.randomUUID().slice(0, 8)}` })
        .where(eq(schema.organization.id, userA.personalOrgId));

      const found = await findPersonalOrganization(services.services.db, userB.userId);
      expect(found?.id).toBe(userB.personalOrgId);

      const ensured = await ensurePersonalOrganization(services.services.db, {
        id: userB.userId,
        name: userB.name,
      });
      expect(ensured?.id).toBe(userB.personalOrgId);
    });

    it("skips anonymous users", async () => {
      const result = await ensurePersonalOrganization(services.services.db, {
        id: crypto.randomUUID(),
        name: "Ghost",
        isAnonymous: true,
      });
      expect(result).toBeNull();
    });

    it("activates the converged org on a session without an active organization", async () => {
      const user = await createTestUser(services.services);
      await services.services.db
        .update(schema.organization)
        .set({ slug: `renamed-${crypto.randomUUID().slice(0, 8)}` })
        .where(eq(schema.organization.id, user.personalOrgId));
      const session = await services.services.db.query.session.findFirst({
        where: eq(schema.session.userId, user.userId),
      });
      await services.services.db
        .update(schema.session)
        .set({ activeOrganizationId: null })
        .where(eq(schema.session.id, session?.id ?? ""));

      await activateDefaultOrganizationForSession(services.services.db, {
        id: session?.id ?? "",
        userId: user.userId,
        activeOrganizationId: null,
      });

      const updated = await services.services.db.query.session.findFirst({
        where: eq(schema.session.id, session?.id ?? ""),
      });
      expect(updated?.activeOrganizationId).toBe(user.personalOrgId);
    });
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

    it("falls back to the personal org when the remembered org no longer has a membership", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });
      await services.services.db.delete(schema.member).where(eq(schema.member.id, org.memberId));

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
