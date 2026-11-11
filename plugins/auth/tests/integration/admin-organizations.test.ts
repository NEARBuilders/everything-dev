import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import {
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
  type TestUser,
} from "../helpers";

describe("admin organizations", () => {
  let setup: Awaited<ReturnType<typeof createTestServices>>;
  let admin: TestUser;
  let member: TestUser;

  beforeEach(async () => {
    setup = await createTestServices();
    admin = await createTestUser(setup.services);
    await setup.services.db
      .update(schema.user)
      .set({ role: "admin" })
      .where(eq(schema.user.id, admin.userId));
    member = await createTestUser(setup.services);
  });

  afterEach(async () => {
    await setup.driver.close();
  });

  it("rejects anonymous and non-admin callers", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    for (const reqHeaders of [undefined, member.reqHeaders]) {
      await expect(handlers.adminListOrganizations({ context: { reqHeaders } })).rejects.toThrow();
      await expect(
        handlers.adminGetOrganizationFull({
          input: { organizationId: org.id },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminCreateOrganizationForUser({
          input: { userId: member.userId, name: "Nope" },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminUpdateOrganization({
          input: { organizationId: org.id, data: { name: "Nope" } },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminDeleteOrganization({
          input: { organizationId: org.id },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminAddMember({
          input: { organizationId: org.id, userId: admin.userId, role: "member" },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminCreateTeam({
          input: { organizationId: org.id, name: "Nope" },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
      await expect(
        handlers.adminRemoveTeamMember({
          input: { teamId: "missing", userId: member.userId },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
    }
  });

  it("lists organizations with member and team counts", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId, { name: "Acme Builders" });
    await handlers.adminCreateTeam({
      input: { organizationId: org.id, name: "Acme Team" },
      context: { reqHeaders: admin.reqHeaders },
    });

    const result = await handlers.adminListOrganizations({
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(result.total).toBeGreaterThanOrEqual(3);
    const listed = result.organizations.find((row) => row.id === org.id);
    expect(listed).toMatchObject({ name: "Acme Builders", memberCount: 1, teamCount: 1 });
    expect(listed?.createdAt).toBeInstanceOf(Date);
  });

  it("filters by search, status, and personal flag", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId, {
      name: "Acme Builders",
      slug: "acme-builders",
    });
    await setup.services.db
      .update(schema.organization)
      .set({ status: "pending" })
      .where(eq(schema.organization.id, org.id));

    const byName = await handlers.adminListOrganizations({
      input: { search: "acme buil" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(byName.total).toBe(1);
    expect(byName.organizations[0]?.id).toBe(org.id);

    const bySlug = await handlers.adminListOrganizations({
      input: { search: "acme-build" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(bySlug.total).toBe(1);
    expect(bySlug.organizations[0]?.slug).toBe("acme-builders");

    const byId = await handlers.adminListOrganizations({
      input: { search: org.id },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(byId.total).toBe(1);

    const pending = await handlers.adminListOrganizations({
      input: { status: "pending" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(pending.total).toBe(1);
    expect(pending.organizations[0]?.id).toBe(org.id);

    const personal = await handlers.adminListOrganizations({
      input: { personal: true },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(personal.total).toBe(2);
    expect(personal.organizations.map((row) => row.slug).sort()).toEqual(
      [admin.userId, member.userId].sort(),
    );

    const nonPersonal = await handlers.adminListOrganizations({
      input: { personal: false },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(nonPersonal.total).toBe(1);
    expect(nonPersonal.organizations[0]?.id).toBe(org.id);
  });

  it("paginates server-side with a hard limit cap", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    for (const name of ["Page Org One", "Page Org Two", "Page Org Three"]) {
      await createTestOrg(setup.services, member.userId, { name });
    }

    const page1 = await handlers.adminListOrganizations({
      input: { personal: false, limit: 2 },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(page1.total).toBe(3);
    expect(page1.organizations).toHaveLength(2);

    const page2 = await handlers.adminListOrganizations({
      input: { personal: false, limit: 2, offset: 2 },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(page2.total).toBe(3);
    expect(page2.organizations).toHaveLength(1);
    const page1Ids = page1.organizations.map((row) => row.id);
    expect(page1Ids).not.toContain(page2.organizations[0]?.id);

    await expect(
      handlers.adminListOrganizations({
        input: { limit: 101 },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("returns full organization detail with members and teams", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    await setup.services.db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: org.id,
      userId: admin.userId,
      role: "admin",
      createdAt: new Date(),
    });
    await handlers.adminCreateTeam({
      input: { organizationId: org.id, name: "Detail Team", metadata: { areas: ["web"] } },
      context: { reqHeaders: admin.reqHeaders },
    });

    const full = await handlers.adminGetOrganizationFull({
      input: { organizationId: org.id },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(full).toMatchObject({ id: org.id, name: org.name, slug: org.slug });
    expect(full.members).toHaveLength(2);
    const memberRow = full.members.find((row) => row.userId === member.userId);
    expect(memberRow).toMatchObject({
      role: "owner",
      user: { id: member.userId, email: member.email },
    });
    expect(full.teams).toHaveLength(1);
    expect(full.teams[0]).toMatchObject({ name: "Detail Team", areas: ["web"] });
    expect(full.invitations).toEqual([]);

    await expect(
      handlers.adminGetOrganizationFull({
        input: { organizationId: "missing-org" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("creates an organization for a user with an owner member row", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const created = await handlers.adminCreateOrganizationForUser({
      input: { userId: member.userId, name: "Admin Made Org" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(created).toMatchObject({ name: "Admin Made Org", slug: "admin-made-org" });

    const memberRow = await setup.services.db.query.member.findFirst({
      where: eq(schema.member.organizationId, created.id),
    });
    expect(memberRow).toMatchObject({ userId: member.userId, role: "owner" });

    await expect(
      handlers.adminCreateOrganizationForUser({
        input: { userId: member.userId, name: "Dup", slug: created.slug },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminCreateOrganizationForUser({
        input: { userId: "missing-user", name: "Ghost Org" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("updates an organization and enforces slug uniqueness", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    const other = await createTestOrg(setup.services, admin.userId);

    const updated = await handlers.adminUpdateOrganization({
      input: {
        organizationId: org.id,
        data: { name: "Renamed Org", status: "rejected", metadata: { tier: "pro" } },
      },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(updated).toMatchObject({
      id: org.id,
      name: "Renamed Org",
      status: "rejected",
      metadata: { tier: "pro" },
    });

    const row = await setup.services.db.query.organization.findFirst({
      where: eq(schema.organization.id, org.id),
    });
    expect(row).toMatchObject({ name: "Renamed Org", status: "rejected" });

    await expect(
      handlers.adminUpdateOrganization({
        input: { organizationId: org.id, data: { slug: other.slug } },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminUpdateOrganization({
        input: { organizationId: "missing-org", data: { name: "Ghost" } },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("deletes an organization with its members", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    const extra = await createTestUser(setup.services);
    await setup.services.db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: org.id,
      userId: extra.userId,
      role: "member",
      createdAt: new Date(),
    });

    const result = await handlers.adminDeleteOrganization({
      input: { organizationId: org.id },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(result.success).toBe(true);

    const gone = await setup.services.db.query.organization.findFirst({
      where: eq(schema.organization.id, org.id),
    });
    expect(gone).toBeUndefined();
    const members = await setup.services.db.query.member.findMany({
      where: eq(schema.member.organizationId, org.id),
    });
    expect(members).toEqual([]);

    await expect(
      handlers.adminDeleteOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("adds, retitles, and removes members", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, admin.userId);

    const added = await handlers.adminAddMember({
      input: { organizationId: org.id, userId: member.userId, role: "admin" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(added).toMatchObject({
      organizationId: org.id,
      userId: member.userId,
      role: "admin",
    });

    await expect(
      handlers.adminAddMember({
        input: { organizationId: org.id, userId: member.userId, role: "member" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    const promoted = await handlers.adminUpdateMemberRole({
      input: { organizationId: org.id, userId: member.userId, role: "owner" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(promoted.role).toBe("owner");

    const removed = await handlers.adminRemoveMember({
      input: { organizationId: org.id, userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(removed.success).toBe(true);

    await expect(
      handlers.adminRemoveMember({
        input: { organizationId: org.id, userId: member.userId },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminRemoveMember({
        input: { organizationId: org.id, userId: admin.userId },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminUpdateMemberRole({
        input: { organizationId: "missing-org", userId: member.userId, role: "member" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("enforces the organization membership limit when adding members", async () => {
    const limited = await createTestServices({ organizationMembershipLimit: 1 });
    try {
      const limitedAdmin = await createTestUser(limited.services);
      await limited.services.db
        .update(schema.user)
        .set({ role: "admin" })
        .where(eq(schema.user.id, limitedAdmin.userId));
      const handlers = createTestHandlers(limited.services).adminOrganizations;
      const org = await createTestOrg(limited.services, limitedAdmin.userId);
      const outsider = await createTestUser(limited.services);

      await expect(
        handlers.adminAddMember({
          input: { organizationId: org.id, userId: outsider.userId, role: "member" },
          context: { reqHeaders: limitedAdmin.reqHeaders },
        }),
      ).rejects.toThrow();
    } finally {
      await limited.driver.close();
    }
  });

  it("adds a member without the admin belonging to the organization", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    const outsider = await createTestUser(setup.services);

    const added = await handlers.adminAddMember({
      input: { organizationId: org.id, userId: outsider.userId, role: "member" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(added).toMatchObject({
      organizationId: org.id,
      userId: outsider.userId,
      role: "member",
    });

    const row = await setup.services.db.query.member.findFirst({
      where: and(
        eq(schema.member.organizationId, org.id),
        eq(schema.member.userId, outsider.userId),
      ),
    });
    expect(row).toMatchObject({ role: "member" });

    await expect(
      handlers.adminAddMember({
        input: { organizationId: org.id, userId: outsider.userId, role: "member" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminAddMember({
        input: { organizationId: org.id, userId: "missing-user", role: "member" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("refuses to demote the only owner of an organization", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);
    const second = await createTestUser(setup.services);

    await expect(
      handlers.adminUpdateMemberRole({
        input: { organizationId: org.id, userId: member.userId, role: "member" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    const stillOwner = await setup.services.db.query.member.findFirst({
      where: and(eq(schema.member.organizationId, org.id), eq(schema.member.userId, member.userId)),
    });
    expect(stillOwner?.role).toBe("owner");

    await handlers.adminAddMember({
      input: { organizationId: org.id, userId: second.userId, role: "owner" },
      context: { reqHeaders: admin.reqHeaders },
    });

    const demoted = await handlers.adminUpdateMemberRole({
      input: { organizationId: org.id, userId: member.userId, role: "member" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(demoted.role).toBe("member");
  });

  it("creates, updates, and deletes teams", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, member.userId);

    const created = await handlers.adminCreateTeam({
      input: { organizationId: org.id, name: "Ops Team", metadata: { areas: ["dev"] } },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(created).toMatchObject({
      organizationId: org.id,
      name: "Ops Team",
      areas: ["dev"],
    });

    const withEvent = await handlers.adminCreateTeam({
      input: { organizationId: org.id, name: "Event Team", eventId: "evt_1" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(withEvent.name).toBe("Event Team");
    const eventTeamRow = await setup.services.db.query.team.findFirst({
      where: eq(schema.team.id, withEvent.id),
    });
    expect(eventTeamRow?.eventId).toBe("evt_1");

    await expect(
      handlers.adminCreateTeam({
        input: { organizationId: org.id, name: "Event Team Dup", eventId: "evt_1" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    const updated = await handlers.adminUpdateTeam({
      input: { teamId: created.id, data: { name: "Ops Team Renamed" } },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(updated.name).toBe("Ops Team Renamed");

    const deleted = await handlers.adminDeleteTeam({
      input: { teamId: created.id },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(deleted.success).toBe(true);

    const gone = await setup.services.db.query.team.findFirst({
      where: eq(schema.team.id, created.id),
    });
    expect(gone).toBeUndefined();

    await expect(
      handlers.adminUpdateTeam({
        input: { teamId: created.id, data: { name: "Ghost" } },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminCreateTeam({
        input: { organizationId: "missing-org", name: "Ghost Team" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });

  it("adds and removes team members", async () => {
    const handlers = createTestHandlers(setup.services).adminOrganizations;
    const org = await createTestOrg(setup.services, admin.userId);
    const team = await handlers.adminCreateTeam({
      input: { organizationId: org.id, name: "Member Team" },
      context: { reqHeaders: admin.reqHeaders },
    });
    const outsider = await createTestUser(setup.services);
    await setup.services.db.insert(schema.member).values({
      id: crypto.randomUUID(),
      organizationId: org.id,
      userId: outsider.userId,
      role: "member",
      createdAt: new Date(),
    });

    const added = await handlers.adminAddTeamMember({
      input: { teamId: team.id, userId: outsider.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(added).toMatchObject({ teamId: team.id, userId: outsider.userId, role: "member" });

    const teamRow = await setup.services.db.query.team.findFirst({
      where: eq(schema.team.id, team.id),
    });
    expect(teamRow?.memberCount).toBe(1);

    await expect(
      handlers.adminAddTeamMember({
        input: { teamId: team.id, userId: member.userId },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    await expect(
      handlers.adminAddTeamMember({
        input: { teamId: team.id, userId: outsider.userId, role: "boss" },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();

    const removed = await handlers.adminRemoveTeamMember({
      input: { teamId: team.id, userId: outsider.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(removed.success).toBe(true);

    const drainedTeam = await setup.services.db.query.team.findFirst({
      where: eq(schema.team.id, team.id),
    });
    expect(drainedTeam?.memberCount).toBe(0);

    await expect(
      handlers.adminRemoveTeamMember({
        input: { teamId: team.id, userId: outsider.userId },
        context: { reqHeaders: admin.reqHeaders },
      }),
    ).rejects.toThrow();
  });
});
