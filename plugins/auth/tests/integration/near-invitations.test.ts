import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../src/db/schema";
import { nearInvitationEmail } from "../../src/near-invitations";
import {
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
  type TestUser,
} from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

type NearNetwork = "mainnet" | "testnet";

function walletId() {
  return `wallet-${crypto.randomUUID().slice(0, 8)}.near`;
}

async function linkWallet(user: TestUser, accountId: string, network: NearNetwork = "mainnet") {
  await services.services.db.insert(schema.nearAccount).values({
    id: crypto.randomUUID(),
    userId: user.userId,
    accountId,
    network,
    publicKey: "ed25519:test",
    isPrimary: true,
    createdAt: new Date(),
  });
}

async function walletInvitation(options: { withTeam?: boolean; nearNetwork?: NearNetwork } = {}) {
  const owner = await createTestUser(services.services);
  const org = await createTestOrg(services.services, owner.userId);
  const handlers = createTestHandlers(services.services);
  const nearNetwork = options.nearNetwork ?? "mainnet";
  const team = options.withTeam
    ? await handlers.teams.createTeam({
        input: { name: "Node Operator", organizationId: org.id, areas: ["node-operations"] },
        context: { reqHeaders: owner.reqHeaders },
      })
    : null;
  const nearAccountId = walletId();
  const invitation = await handlers.invitations.inviteMember({
    input: {
      nearAccountId,
      nearNetwork,
      role: "member",
      organizationId: org.id,
      ...(team ? { teamId: team.id } : {}),
    },
    context: { reqHeaders: owner.reqHeaders },
  });
  return { owner, org, team, handlers, nearAccountId, nearNetwork, invitation };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("NEAR-account invitations", () => {
  it("creates a wallet invitation without sending an email", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { owner, org, handlers, nearAccountId, invitation } = await walletInvitation();

      expect(invitation).toMatchObject({
        nearAccountId,
        nearNetwork: "mainnet",
        email: nearInvitationEmail(nearAccountId, "mainnet"),
        status: "pending",
        role: "member",
      });
      expect(log.mock.calls.flat().join("\n")).not.toContain("Invitation to join");
      const listed = await handlers.invitations.listInvitations({
        input: { organizationId: org.id },
        context: { reqHeaders: owner.reqHeaders },
      });
      expect(listed).toEqual([expect.objectContaining({ id: invitation.id, nearAccountId })]);

      const resent = await handlers.invitations.inviteMember({
        input: {
          nearAccountId,
          nearNetwork: "mainnet",
          role: "member",
          organizationId: org.id,
          resend: true,
        },
        context: { reqHeaders: owner.reqHeaders },
      });
      expect(resent).toMatchObject({
        id: invitation.id,
        nearAccountId,
        nearNetwork: "mainnet",
        email: nearInvitationEmail(nearAccountId, "mainnet"),
      });
    } finally {
      log.mockRestore();
    }
  });

  it("rejects malformed account ids and ambiguous invitees", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const handlers = createTestHandlers(services.services);

    for (const input of [
      { nearAccountId: "Not A Wallet!" },
      { nearAccountId: "alice.near", email: "alice@example.com" },
      { nearAccountId: "alice.near", nearNetwork: "sidechain" },
      { nearAccountId: "alice.near" },
      { email: "alice@example.com", nearNetwork: "mainnet" },
      {},
    ]) {
      await expect(
        handlers.invitations.inviteMember({
          input: { ...input, role: "member", organizationId: org.id },
          context: { reqHeaders: owner.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("keeps the same account name separate across networks", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const handlers = createTestHandlers(services.services);
    const nearAccountId = "shared.near";
    const mainnetInvitation = await handlers.invitations.inviteMember({
      input: { nearAccountId, nearNetwork: "mainnet", role: "member", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    const testnetInvitation = await handlers.invitations.inviteMember({
      input: { nearAccountId, nearNetwork: "testnet", role: "member", organizationId: org.id },
      context: { reqHeaders: owner.reqHeaders },
    });
    const mainnetUser = await createTestUser(services.services);
    const testnetUser = await createTestUser(services.services);
    await linkWallet(mainnetUser, nearAccountId, "mainnet");
    await linkWallet(testnetUser, nearAccountId, "testnet");

    await expect(
      handlers.invitations.listUserInvitations({
        context: { reqHeaders: mainnetUser.reqHeaders },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: mainnetInvitation.id, nearNetwork: "mainnet" }),
    ]);
    await expect(
      handlers.invitations.listUserInvitations({
        context: { reqHeaders: testnetUser.reqHeaders },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: testnetInvitation.id, nearNetwork: "testnet" }),
    ]);

    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: testnetInvitation.id },
        context: { reqHeaders: mainnetUser.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("validates and canonicalizes wallet fields through the Better Auth endpoint", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);

    await expect(
      services.services.auth.api.createInvitation({
        headers: owner.headers,
        body: {
          email: "wrong@example.com",
          nearAccountId: "direct.near",
          role: "member",
          organizationId: org.id,
        },
      }),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ message: expect.stringContaining("network") }),
    });

    await expect(
      services.services.auth.api.createInvitation({
        headers: owner.headers,
        body: {
          email: "email@example.com",
          nearNetwork: "mainnet",
          role: "member",
          organizationId: org.id,
        },
      }),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ message: expect.stringContaining("network") }),
    });

    const created = await services.services.auth.api.createInvitation({
      headers: owner.headers,
      body: {
        email: "wrong@example.com",
        nearAccountId: "direct.near",
        nearNetwork: "testnet",
        role: "member",
        organizationId: org.id,
      },
    });
    expect(created).toMatchObject({
      email: nearInvitationEmail("direct.near", "testnet"),
      nearAccountId: "direct.near",
      nearNetwork: "testnet",
    });

    await expect(
      services.services.auth.api.createInvitation({
        headers: owner.headers,
        body: {
          email: "another@example.com",
          nearAccountId: "direct.near",
          nearNetwork: "testnet",
          role: "member",
          organizationId: org.id,
        },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  });

  it("keeps legacy wallet invitations stored but requires reissue", async () => {
    const owner = await createTestUser(services.services);
    const org = await createTestOrg(services.services, owner.userId);
    const handlers = createTestHandlers(services.services);
    const nearAccountId = "legacy.near";
    const [legacy] = await services.services.db
      .insert(schema.invitation)
      .values({
        id: crypto.randomUUID(),
        organizationId: org.id,
        email: `${nearAccountId}@near-wallet.invalid`,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        inviterId: owner.userId,
        nearAccountId,
        nearNetwork: null,
      })
      .returning();
    if (!legacy) throw new Error("Failed to create legacy invitation fixture");
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId, "mainnet");

    await expect(
      handlers.invitations.listUserInvitations({
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).resolves.toEqual([]);
    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: legacy.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("reissue"),
    });
    await expect(
      handlers.invitations.rejectNearInvitation({
        input: { invitationId: legacy.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("reissue"),
    });
  });

  it("resends expired wallet invitations with their network identity", async () => {
    const expired = await walletInvitation({ nearNetwork: "testnet" });
    await services.services.db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, expired.invitation.id));

    const resent = await expired.handlers.invitations.inviteMember({
      input: {
        nearAccountId: expired.nearAccountId,
        nearNetwork: expired.nearNetwork,
        role: "member",
        organizationId: expired.org.id,
        resend: true,
      },
      context: { reqHeaders: expired.owner.reqHeaders },
    });
    expect(resent).toMatchObject({
      email: nearInvitationEmail(expired.nearAccountId, "testnet"),
      nearAccountId: expired.nearAccountId,
      nearNetwork: "testnet",
      status: "pending",
    });
    expect(resent.id).not.toBe(expired.invitation.id);

    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, expired.nearAccountId, "testnet");
    await expect(
      expired.handlers.invitations.acceptNearInvitation({
        input: { invitationId: resent.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      services.services.db.query.invitation.findFirst({
        where: eq(schema.invitation.id, resent.id),
      }),
    ).resolves.toMatchObject({ status: "accepted", nearNetwork: "testnet" });
  });

  it("accepts with the invited wallet, joining the organization and team workspace", async () => {
    const { org, team, handlers, nearAccountId, invitation } = await walletInvitation({
      withTeam: true,
    });
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);

    await handlers.invitations.acceptNearInvitation({
      input: { invitationId: invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });

    const context = await handlers.session.getContext({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(context.organization.activeOrganizationId).toBe(org.id);
    expect(context.organization.member?.role).toBe("member");
    expect(context.organization.activeTeamId).toBe(team?.id);
    expect(context.organization.teams).toEqual([
      { id: team?.id, name: "Node Operator", areas: ["node-operations"] },
    ]);
  });

  it("rejects acceptance from a different wallet", async () => {
    const { handlers, invitation } = await walletInvitation();
    const impostor = await createTestUser(services.services);
    await linkWallet(impostor, walletId());

    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: impostor.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects expired and already-accepted invitations", async () => {
    const { handlers, nearAccountId, invitation } = await walletInvitation();
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);
    await handlers.invitations.acceptNearInvitation({
      input: { invitationId: invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });

    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const expired = await walletInvitation();
    await linkWallet(invitee, expired.nearAccountId);
    await services.services.db
      .update(schema.invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitation.id, expired.invitation.id));
    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: expired.invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not let a stale rejection overwrite an accepted invitation", async () => {
    const { handlers, nearAccountId, invitation } = await walletInvitation();
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);
    const read = deferred();
    const release = deferred();
    const query = services.services.db.query.invitation as unknown as {
      findFirst: (args?: unknown) => Promise<Awaited<ReturnType<typeof findInvitation>>>;
    };
    async function findInvitation(args?: unknown) {
      return services.services.db.query.invitation.findFirst(args as never);
    }
    const findFirst = query.findFirst.bind(query);
    let paused = false;
    const spy = vi.spyOn(query, "findFirst").mockImplementation(async (args) => {
      const result = await findFirst(args);
      if (!paused) {
        paused = true;
        read.resolve();
        await release.promise;
      }
      return result;
    });

    try {
      const rejection = handlers.invitations.rejectNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      });
      await read.promise;
      await handlers.invitations.acceptNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      });
      release.resolve();
      await expect(rejection).rejects.toMatchObject({
        message: "Invitation is no longer pending",
      });
    } finally {
      release.resolve();
      spy.mockRestore();
    }

    const stored = await services.services.db.query.invitation.findFirst({
      where: eq(schema.invitation.id, invitation.id),
    });
    expect(stored?.status).toBe("accepted");
    const members = await services.services.db.query.member.findMany({
      where: and(
        eq(schema.member.organizationId, invitation.organizationId),
        eq(schema.member.userId, invitee.userId),
      ),
    });
    expect(members).toHaveLength(1);
  });

  it("keeps canceled and rejected invitations terminal", async () => {
    const declined = await walletInvitation();
    const declinee = await createTestUser(services.services);
    await linkWallet(declinee, declined.nearAccountId);
    await declined.handlers.invitations.rejectNearInvitation({
      input: { invitationId: declined.invitation.id },
      context: { reqHeaders: declinee.reqHeaders },
    });
    await expect(
      declined.handlers.invitations.rejectNearInvitation({
        input: { invitationId: declined.invitation.id },
        context: { reqHeaders: declinee.reqHeaders },
      }),
    ).rejects.toMatchObject({ message: "Invitation is already rejected" });

    const canceled = await walletInvitation();
    const canceledInvitee = await createTestUser(services.services);
    await linkWallet(canceledInvitee, canceled.nearAccountId);
    await canceled.handlers.invitations.cancelInvitation({
      input: { invitationId: canceled.invitation.id },
      context: { reqHeaders: canceled.owner.reqHeaders },
    });
    await expect(
      canceled.handlers.invitations.rejectNearInvitation({
        input: { invitationId: canceled.invitation.id },
        context: { reqHeaders: canceledInvitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ message: "Invitation is already canceled" });
  });

  it("does not duplicate membership when session activation fails after acceptance", async () => {
    const { handlers, nearAccountId, invitation } = await walletInvitation();
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);
    const authContext = await (
      services.services.auth as unknown as {
        $context: Promise<{
          internalAdapter: {
            updateSession: (token: string, data: Record<string, unknown>) => Promise<unknown>;
          };
        }>;
      }
    ).$context;
    const spy = vi
      .spyOn(authContext.internalAdapter, "updateSession")
      .mockRejectedValueOnce(new Error("session update failed"));

    try {
      await expect(
        handlers.invitations.acceptNearInvitation({
          input: { invitationId: invitation.id },
          context: { reqHeaders: invitee.reqHeaders },
        }),
      ).rejects.toThrow("session update failed");
    } finally {
      spy.mockRestore();
    }

    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ message: "Invitation is already accepted" });
    const stored = await services.services.db.query.invitation.findFirst({
      where: eq(schema.invitation.id, invitation.id),
    });
    expect(stored?.status).toBe("accepted");
    const members = await services.services.db.query.member.findMany({
      where: and(
        eq(schema.member.organizationId, invitation.organizationId),
        eq(schema.member.userId, invitee.userId),
      ),
    });
    expect(members).toHaveLength(1);
  });

  it("rolls back the invitation and membership when its team disappears", async () => {
    const { org, team, handlers, nearAccountId, invitation } = await walletInvitation({
      withTeam: true,
    });
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);
    await services.services.db.delete(schema.team).where(eq(schema.team.id, team!.id));

    await expect(
      handlers.invitations.acceptNearInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const stored = await services.services.db.query.invitation.findFirst({
      where: eq(schema.invitation.id, invitation.id),
    });
    expect(stored?.status).toBe("pending");
    const members = await services.services.db.query.member.findMany({
      where: and(
        eq(schema.member.organizationId, org.id),
        eq(schema.member.userId, invitee.userId),
      ),
    });
    expect(members).toHaveLength(0);
  });

  it("cannot be accepted through the email acceptance flow", async () => {
    const { handlers, invitation } = await walletInvitation();
    const invitee = await createTestUser(services.services, {
      email: invitation.email,
    });

    await expect(
      handlers.invitations.acceptInvitation({
        input: { invitationId: invitation.id },
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("surfaces pending wallet invitations once the wallet is linked", async () => {
    const { org, nearAccountId, invitation, handlers } = await walletInvitation();
    const invitee = await createTestUser(services.services);

    const before = await handlers.invitations.listUserInvitations({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(before).toEqual([]);

    await linkWallet(invitee, nearAccountId);
    const after = await handlers.invitations.listUserInvitations({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(after).toEqual([
      expect.objectContaining({
        id: invitation.id,
        nearAccountId,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
      }),
    ]);
  });

  it("surfaces wallet invitations for users without a verified email", async () => {
    const { org, nearAccountId, invitation, handlers } = await walletInvitation();
    const invitee = await createTestUser(services.services);
    await services.services.db
      .update(schema.user)
      .set({ emailVerified: false })
      .where(eq(schema.user.id, invitee.userId));
    await linkWallet(invitee, nearAccountId);

    const listed = await handlers.invitations.listUserInvitations({
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(listed).toEqual([
      expect.objectContaining({
        id: invitation.id,
        nearAccountId,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
      }),
    ]);
  });

  it("resolves the claimable link only for the invited wallet", async () => {
    const { org, nearAccountId, invitation, handlers } = await walletInvitation();
    const invitee = await createTestUser(services.services);
    const stranger = await createTestUser(services.services);
    await linkWallet(invitee, nearAccountId);

    const claimed = await handlers.invitations.getInvitation({
      input: { id: invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(claimed).toMatchObject({
      id: invitation.id,
      nearAccountId,
      organizationName: org.name,
      organizationSlug: org.slug,
    });
    const hidden = await handlers.invitations.getInvitation({
      input: { id: invitation.id },
      context: { reqHeaders: stranger.reqHeaders },
    });
    expect(hidden).toBeNull();
  });

  it("can be declined by the invited wallet and canceled by the organization", async () => {
    const declined = await walletInvitation();
    const invitee = await createTestUser(services.services);
    await linkWallet(invitee, declined.nearAccountId);
    await declined.handlers.invitations.rejectNearInvitation({
      input: { invitationId: declined.invitation.id },
      context: { reqHeaders: invitee.reqHeaders },
    });
    expect(
      await declined.handlers.invitations.listUserInvitations({
        context: { reqHeaders: invitee.reqHeaders },
      }),
    ).toEqual([]);

    const canceled = await walletInvitation();
    await canceled.handlers.invitations.cancelInvitation({
      input: { invitationId: canceled.invitation.id },
      context: { reqHeaders: canceled.owner.reqHeaders },
    });
    const listed = await canceled.handlers.invitations.listInvitations({
      input: { organizationId: canceled.org.id },
      context: { reqHeaders: canceled.owner.reqHeaders },
    });
    expect(listed).toEqual([
      expect.objectContaining({ id: canceled.invitation.id, status: "canceled" }),
    ]);
  });
});
