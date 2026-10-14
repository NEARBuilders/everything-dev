import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestHandlers, createTestServices, createTestUser, type TestUser } from "../helpers";

describe("admin users", () => {
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
    const handlers = createTestHandlers(setup.services).adminUsers;
    for (const reqHeaders of [undefined, member.reqHeaders]) {
      await expect(handlers.adminListUsers({ context: { reqHeaders } })).rejects.toThrow();
      await expect(
        handlers.adminGetUser({ input: { userId: member.userId }, context: { reqHeaders } }),
      ).rejects.toThrow();
      await expect(
        handlers.adminSetRole({
          input: { userId: member.userId, role: "admin" },
          context: { reqHeaders },
        }),
      ).rejects.toThrow();
    }
  });

  it("lists users with totals and search", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const result = await handlers.adminListUsers({ context: { reqHeaders: admin.reqHeaders } });
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.users).toContainEqual(expect.objectContaining({ id: member.userId }));

    const searched = await handlers.adminListUsers({
      input: { searchValue: member.email, searchField: "email" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(searched.total).toBe(1);
    expect(searched.users[0]?.id).toBe(member.userId);
  });

  it("gets a single user", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const user = await handlers.adminGetUser({
      input: { userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(user).toMatchObject({ id: member.userId, email: member.email, banned: false });
  });

  it("sets roles", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const promoted = await handlers.adminSetRole({
      input: { userId: member.userId, role: "admin" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(promoted.role).toBe("admin");

    const demoted = await handlers.adminSetRole({
      input: { userId: member.userId, role: "user" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(demoted.role).toBe("user");
  });

  it("bans and unbans with reason and expiry", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const banned = await handlers.adminBanUser({
      input: { userId: member.userId, banReason: "spam", banExpiresIn: 3600 },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(banned.banned).toBe(true);
    expect(banned.banReason).toBe("spam");
    expect(banned.banExpires).toBeInstanceOf(Date);

    const unbanned = await handlers.adminUnbanUser({
      input: { userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(unbanned.banned).toBe(false);
  });

  it("lists and revokes user sessions", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const { sessions } = await handlers.adminListUserSessions({
      input: { userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.impersonatedBy).toBeNull();

    const revoked = await handlers.adminRevokeUserSession({
      input: { sessionToken: sessions[0]!.token },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(revoked.success).toBe(true);

    const allRevoked = await handlers.adminRevokeUserSessions({
      input: { userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(allRevoked.success).toBe(true);
  });

  it("sets a user password", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const result = await handlers.adminSetUserPassword({
      input: { userId: member.userId, newPassword: "NewPassword123!" },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(result.status).toBe(true);
  });

  it("removes a user", async () => {
    const handlers = createTestHandlers(setup.services).adminUsers;
    const result = await handlers.adminRemoveUser({
      input: { userId: member.userId },
      context: { reqHeaders: admin.reqHeaders },
    });
    expect(result.success).toBe(true);
    const gone = await setup.services.db.query.user.findFirst({
      where: eq(schema.user.id, member.userId),
    });
    expect(gone).toBeUndefined();
  });
});

describe("passkeys route", () => {
  let setup: Awaited<ReturnType<typeof createTestServices>>;

  beforeEach(async () => {
    setup = await createTestServices();
  });

  afterEach(async () => {
    await setup.driver.close();
  });

  it("rejects unauthenticated callers", async () => {
    const handlers = createTestHandlers(setup.services).passkeys;
    await expect(handlers.listUserPasskeys({ context: {} })).rejects.toThrow();
  });

  it("returns an empty list for a user without passkeys", async () => {
    const user = await createTestUser(setup.services);
    const handlers = createTestHandlers(setup.services).passkeys;
    const result = await handlers.listUserPasskeys({
      context: { reqHeaders: user.reqHeaders },
    });
    expect(result).toEqual([]);
  });
});
