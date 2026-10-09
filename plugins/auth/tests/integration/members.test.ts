import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../src/db/schema";
import {
  addTestMember,
  createTestApiKey,
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
} from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

async function assertNoMember(organizationId: string, userId: string) {
  const created = await services.services.db.query.member.findFirst({
    where: and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)),
  });
  expect(created).toBeUndefined();
}

describe("member handlers", () => {
  describe("listMembers", () => {
    it("returns all members for an organization", async () => {
      const owner = await createTestUser(services.services);
      const member1 = await createTestUser(services.services, {
        email: `m1-${crypto.randomUUID()}@example.com`,
      });
      const member2 = await createTestUser(services.services, {
        email: `m2-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, member1.userId, "member");
      await addTestMember(services.services, org.id, member2.userId, "admin");

      const handlers = createTestHandlers(services.services);
      const result = (await handlers.members.listMembers({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      })) as { members: Array<{ role: string }>; total: number };

      expect(result.members).toHaveLength(3);
      const roles = result.members.map((m) => m.role).sort();
      expect(roles).toContain("owner");
      expect(roles).toContain("member");
      expect(roles).toContain("admin");
    });

    it("includes user info for each member", async () => {
      const owner = await createTestUser(services.services, { name: "Owner User" });
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      const result = await handlers.members.listMembers({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      expect(result.members[0]!.user).not.toBeNull();
      expect(result.members[0]!.user?.name).toBe("Owner User");
    });
  });

  describe("addMember", () => {
    it("adds a member directly without invitation", async () => {
      const owner = await createTestUser(services.services);
      const newMember = await createTestUser(services.services, {
        email: `addmem-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      const result = await handlers.members.addMember({
        input: { userId: newMember.userId, role: "member", organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      expect(result.id).toBeDefined();
      expect(result.role).toBe("member");
      expect(result.organizationId).toBe(org.id);
    });

    it("rejects callers who are not members of the organization", async () => {
      const owner = await createTestUser(services.services);
      const outsider = await createTestUser(services.services, {
        email: `outsider-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: outsider.userId, role: "owner", organizationId: org.id },
          context: { reqHeaders: outsider.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await assertNoMember(org.id, outsider.userId);
    });

    it("rejects outsiders the same way whether or not the organization exists", async () => {
      const outsider = await createTestUser(services.services, {
        email: `outsider-${crypto.randomUUID()}@example.com`,
      });

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: outsider.userId, role: "member", organizationId: crypto.randomUUID() },
          context: { reqHeaders: outsider.reqHeaders },
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only organization owners and admins can add members",
      });
    });

    it("reports a server error when the permission check fails", async () => {
      const owner = await createTestUser(services.services);
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      const spy = vi
        .spyOn(services.services.auth.api, "hasPermission")
        .mockRejectedValueOnce(
          Object.assign(new Error("Database unavailable"), { statusCode: 500 }),
        );

      const handlers = createTestHandlers(services.services);
      try {
        await expect(
          handlers.members.addMember({
            input: { userId: newcomer.userId, role: "member", organizationId: org.id },
            context: { reqHeaders: owner.reqHeaders },
          }),
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      } finally {
        spy.mockRestore();
      }
    });

    it("rejects plain members", async () => {
      const owner = await createTestUser(services.services);
      const member = await createTestUser(services.services, {
        email: `plain-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, member.userId, "member");

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: newcomer.userId, role: "member", organizationId: org.id },
          context: { reqHeaders: member.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await assertNoMember(org.id, newcomer.userId);
    });

    it("lets admins add members but not owners", async () => {
      const owner = await createTestUser(services.services);
      const admin = await createTestUser(services.services, {
        email: `admin-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, admin.userId, "admin");

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: newcomer.userId, role: "owner", organizationId: org.id },
          context: { reqHeaders: admin.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const added = await handlers.members.addMember({
        input: { userId: newcomer.userId, role: "member", organizationId: org.id },
        context: { reqHeaders: admin.reqHeaders },
      });
      expect(added.role).toBe("member");
    });

    it("lets platform admins add owners to organizations they don't belong to", async () => {
      const owner = await createTestUser(services.services);
      const platformAdmin = await createTestUser(services.services, {
        email: `platform-admin-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await services.services.db
        .update(schema.user)
        .set({ role: "admin" })
        .where(eq(schema.user.id, platformAdmin.userId));

      const handlers = createTestHandlers(services.services);
      const added = await handlers.members.addMember({
        input: { userId: newcomer.userId, role: "owner", organizationId: org.id },
        context: { reqHeaders: platformAdmin.reqHeaders },
      });
      expect(added.role).toBe("owner");
    });

    it("lets owners add owners", async () => {
      const owner = await createTestUser(services.services);
      const coOwner = await createTestUser(services.services, {
        email: `co-owner-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      const added = await handlers.members.addMember({
        input: { userId: coOwner.userId, role: "owner", organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });
      expect(added.role).toBe("owner");
    });

    it("rejects an admin of another organization the same way as other outsiders", async () => {
      const ownerA = await createTestUser(services.services);
      const ownerB = await createTestUser(services.services, {
        email: `owner-b-${crypto.randomUUID()}@example.com`,
      });
      const adminA = await createTestUser(services.services, {
        email: `admin-a-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const orgA = await createTestOrg(services.services, ownerA.userId);
      const orgB = await createTestOrg(services.services, ownerB.userId);
      await addTestMember(services.services, orgA.id, adminA.userId, "admin");

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: newcomer.userId, role: "member", organizationId: orgB.id },
          context: { reqHeaders: adminA.reqHeaders },
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only organization owners and admins can add members",
      });

      await assertNoMember(orgB.id, newcomer.userId);
    });

    it("rejects plain members adding to their active organization", async () => {
      const owner = await createTestUser(services.services);
      const member = await createTestUser(services.services, {
        email: `active-plain-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, member.userId, "member");

      const handlers = createTestHandlers(services.services);
      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: member.reqHeaders },
      });

      await expect(
        handlers.members.addMember({
          input: { userId: newcomer.userId, role: "member" },
          context: { reqHeaders: member.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await assertNoMember(org.id, newcomer.userId);
    });
  });

  describe("addMember with an API key", () => {
    it("lets an organization admin add a member with their own API key", async () => {
      const owner = await createTestUser(services.services);
      const admin = await createTestUser(services.services, {
        email: `key-admin-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, admin.userId, "admin");
      const apiKey = await createTestApiKey(services.services, { userId: admin.userId });

      const handlers = createTestHandlers(services.services);
      const added = await handlers.members.addMember({
        input: { userId: newcomer.userId, role: "member", organizationId: org.id },
        context: { reqHeaders: { "x-api-key": apiKey.key } },
      });

      expect(added.role).toBe("member");
      expect(added.organizationId).toBe(org.id);
    });

    it("rejects a plain member's API key", async () => {
      const owner = await createTestUser(services.services);
      const member = await createTestUser(services.services, {
        email: `key-plain-${crypto.randomUUID()}@example.com`,
      });
      const newcomer = await createTestUser(services.services, {
        email: `newcomer-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, member.userId, "member");
      const apiKey = await createTestApiKey(services.services, { userId: member.userId });

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.addMember({
          input: { userId: newcomer.userId, role: "member", organizationId: org.id },
          context: { reqHeaders: { "x-api-key": apiKey.key } },
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only organization owners and admins can add members",
      });
    });
  }, 30000);

  describe("removeMember", () => {
    it("rejects a plain member and keeps the target member row", async () => {
      const owner = await createTestUser(services.services);
      const member1 = await createTestUser(services.services, {
        email: `r1-${crypto.randomUUID()}@example.com`,
      });
      const member2 = await createTestUser(services.services, {
        email: `r2-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      const m1MemberId = await addTestMember(services.services, org.id, member1.userId, "member");
      await addTestMember(services.services, org.id, member2.userId, "member");

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.removeMember({
          input: { memberIdOrEmail: m1MemberId, organizationId: org.id },
          context: { reqHeaders: member2.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      const stillMember = await services.services.db.query.member.findFirst({
        where: eq(schema.member.id, m1MemberId),
      });
      expect(stillMember).toBeDefined();
    });

    it("allows admin to remove member", async () => {
      const owner = await createTestUser(services.services);
      const admin = await createTestUser(services.services, {
        email: `adm-${crypto.randomUUID()}@example.com`,
      });
      const member = await createTestUser(services.services, {
        email: `rem-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, admin.userId, "admin");
      const memberMemberId = await addTestMember(
        services.services,
        org.id,
        member.userId,
        "member",
      );

      const handlers = createTestHandlers(services.services);
      const result = await handlers.members.removeMember({
        input: { memberIdOrEmail: memberMemberId, organizationId: org.id },
        context: { reqHeaders: admin.reqHeaders },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("updateMemberRole", () => {
    it("updates member to admin as owner", async () => {
      const owner = await createTestUser(services.services);
      const member = await createTestUser(services.services, {
        email: `up-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      const memberMemberId = await addTestMember(
        services.services,
        org.id,
        member.userId,
        "member",
      );

      const handlers = createTestHandlers(services.services);
      const result = await handlers.members.updateMemberRole({
        input: { memberId: memberMemberId, organizationId: org.id, role: "admin" },
        context: { reqHeaders: owner.reqHeaders },
      });

      expect(result.role).toBe("admin");
    });

    it("throws when admin tries to assign owner role", async () => {
      const owner = await createTestUser(services.services);
      const admin = await createTestUser(services.services, {
        email: `ao-${crypto.randomUUID()}@example.com`,
      });
      const member = await createTestUser(services.services, {
        email: `mo-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, admin.userId, "admin");
      const memberMemberId = await addTestMember(
        services.services,
        org.id,
        member.userId,
        "member",
      );

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.updateMemberRole({
          input: { memberId: memberMemberId, organizationId: org.id, role: "owner" },
          context: { reqHeaders: admin.reqHeaders },
        }),
      ).rejects.toThrow();
    });

    it("rejects a plain member updating another member's role and keeps the role", async () => {
      const owner = await createTestUser(services.services);
      const member = await createTestUser(services.services, {
        email: `mu-${crypto.randomUUID()}@example.com`,
      });
      const target = await createTestUser(services.services, {
        email: `mt-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner.userId);
      await addTestMember(services.services, org.id, member.userId, "member");
      const targetMemberId = await addTestMember(
        services.services,
        org.id,
        target.userId,
        "member",
      );

      const handlers = createTestHandlers(services.services);
      await expect(
        handlers.members.updateMemberRole({
          input: { memberId: targetMemberId, organizationId: org.id, role: "admin" },
          context: { reqHeaders: member.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const unchanged = await services.services.db.query.member.findFirst({
        where: eq(schema.member.id, targetMemberId),
      });
      expect(unchanged?.role).toBe("member");
    });

    it("allows owner to demote when other owners exist", async () => {
      const owner1 = await createTestUser(services.services);
      const owner2 = await createTestUser(services.services, {
        email: `o2-${crypto.randomUUID()}@example.com`,
      });
      const org = await createTestOrg(services.services, owner1.userId);
      const owner2MemberId = await addTestMember(services.services, org.id, owner2.userId, "owner");

      const handlers = createTestHandlers(services.services);
      const result = await handlers.members.updateMemberRole({
        input: { memberId: owner2MemberId, organizationId: org.id, role: "admin" },
        context: { reqHeaders: owner1.reqHeaders },
      });

      expect(result.role).toBe("admin");
    });
  });

  describe("getActiveMember", () => {
    it("returns member info when user is in org", async () => {
      const owner = await createTestUser(services.services);
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      const result = await handlers.members.getActiveMember({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      expect(result.id).not.toBeNull();
      expect(result.role).toBe("owner");
    });
  });

  describe("getActiveMemberRole", () => {
    it("returns role when user is in org", async () => {
      const owner = await createTestUser(services.services);
      const org = await createTestOrg(services.services, owner.userId);

      const handlers = createTestHandlers(services.services);
      await handlers.organizations.setActiveOrganization({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      const result = await handlers.members.getActiveMemberRole({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });

      expect(result).toEqual({ role: "owner" });
    });
  });
});
