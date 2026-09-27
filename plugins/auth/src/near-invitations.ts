import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import * as schema from "./db/schema";
import {
  createOrganizationMembershipPolicy,
  type OrganizationMembershipPolicy,
} from "./organization-membership-policy";

const NEAR_INVITATION_EMAIL_DOMAIN = "near-wallet.invalid";
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT_ACCOUNT = /^0x[0-9a-f]{40}$/;
const NAMED_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const NEAR_NETWORKS = ["mainnet", "testnet"] as const;
export type NearNetwork = (typeof NEAR_NETWORKS)[number];

export function isNearNetwork(value: unknown): value is NearNetwork {
  return value === "mainnet" || value === "testnet";
}

export function normalizeNearAccountId(value: string): string | null {
  const accountId = value.trim().toLowerCase();
  if (IMPLICIT_ACCOUNT.test(accountId) || ETH_IMPLICIT_ACCOUNT.test(accountId)) return accountId;
  if (accountId.length < 2 || accountId.length > 64) return null;
  return NAMED_ACCOUNT.test(accountId) ? accountId : null;
}

export function nearInvitationEmail(accountId: string, network: NearNetwork): string {
  return `${accountId}@${network}.${NEAR_INVITATION_EMAIL_DOMAIN}`;
}

export function isNearInvitation(invitation: unknown): boolean {
  return (
    !!invitation &&
    typeof invitation === "object" &&
    typeof (invitation as { nearAccountId?: unknown }).nearAccountId === "string"
  );
}

export async function listLinkedNearAccounts(
  db: Database,
  userId: string,
): Promise<Array<{ accountId: string; network: NearNetwork }>> {
  const rows = await db
    .select({ accountId: schema.nearAccount.accountId, network: schema.nearAccount.network })
    .from(schema.nearAccount)
    .where(eq(schema.nearAccount.userId, userId));
  return rows.filter((row): row is { accountId: string; network: NearNetwork } =>
    isNearNetwork(row.network),
  );
}

export async function listPendingNearInvitations(db: Database, userId: string) {
  const linkedAccounts = await listLinkedNearAccounts(db, userId);
  if (linkedAccounts.length === 0) return [];
  const identityFilters = linkedAccounts.map(({ accountId, network }) =>
    and(eq(schema.invitation.nearAccountId, accountId), eq(schema.invitation.nearNetwork, network)),
  );
  return db
    .select({
      invitation: schema.invitation,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.invitation.organizationId, schema.organization.id))
    .where(
      and(
        or(...identityFilters),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    );
}

async function findClaimableInvitation(db: Database, invitationId: string, userId: string) {
  const invitation = await db.query.invitation.findFirst({
    where: eq(schema.invitation.id, invitationId),
  });
  if (!invitation?.nearAccountId) {
    throw new APIError("BAD_REQUEST", { message: "Wallet invitation not found" });
  }
  if (!isNearNetwork(invitation.nearNetwork)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "This legacy wallet invitation has no network. Ask the organization to cancel and reissue it.",
    });
  }
  if (invitation.status !== "pending") {
    throw new APIError("BAD_REQUEST", { message: `Invitation is already ${invitation.status}` });
  }
  if (invitation.expiresAt < new Date()) {
    throw new APIError("BAD_REQUEST", { message: "Invitation has expired" });
  }
  const linked = await listLinkedNearAccounts(db, userId);
  if (
    !linked.some(
      (account) =>
        account.accountId === invitation.nearAccountId &&
        account.network === invitation.nearNetwork,
    )
  ) {
    throw new APIError("FORBIDDEN", {
      message: `This invitation is for ${invitation.nearAccountId} on ${invitation.nearNetwork}. Sign in with or link that NEAR account on the invited network to accept it.`,
    });
  }
  return invitation;
}

const invitationBody = z.object({ invitationId: z.string() });

export function nearInvitations(
  db: Database,
  membershipPolicy: OrganizationMembershipPolicy = createOrganizationMembershipPolicy(),
) {
  return {
    id: "near-invitations",
    endpoints: {
      acceptNearInvitation: createAuthEndpoint(
        "/organization/accept-near-invitation",
        { method: "POST", body: invitationBody, use: [sessionMiddleware] },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          const invitation = await findClaimableInvitation(db, ctx.body.invitationId, user.id);
          const teamIds = invitation.teamId ? invitation.teamId.split(",") : [];

          const member = await db.transaction(async (tx) => {
            const [organization] = await tx
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(eq(schema.organization.id, invitation.organizationId))
              .for("update");
            if (!organization) {
              throw new APIError("BAD_REQUEST", { message: "Organization not found" });
            }
            const existing = await tx.query.member.findFirst({
              where: and(
                eq(schema.member.userId, user.id),
                eq(schema.member.organizationId, invitation.organizationId),
              ),
            });
            if (existing) {
              throw new APIError("BAD_REQUEST", {
                message: "You are already a member of this organization",
              });
            }
            const [{ memberCount } = { memberCount: 0 }] = await tx
              .select({ memberCount: sql<number>`count(*)::int` })
              .from(schema.member)
              .where(eq(schema.member.organizationId, invitation.organizationId));
            if (!membershipPolicy.hasCapacity(memberCount)) {
              throw new APIError("FORBIDDEN", {
                message: "Organization membership limit reached",
              });
            }
            const now = new Date();
            const [accepted] = await tx
              .update(schema.invitation)
              .set({ status: "accepted" })
              .where(
                and(
                  eq(schema.invitation.id, invitation.id),
                  eq(schema.invitation.status, "pending"),
                  gt(schema.invitation.expiresAt, now),
                ),
              )
              .returning();
            if (!accepted) {
              if (invitation.expiresAt <= now) {
                throw new APIError("BAD_REQUEST", { message: "Invitation has expired" });
              }
              throw new APIError("BAD_REQUEST", { message: "Invitation is no longer pending" });
            }
            for (const teamId of teamIds) {
              const team = await tx.query.team.findFirst({
                where: and(
                  eq(schema.team.id, teamId),
                  eq(schema.team.organizationId, invitation.organizationId),
                ),
              });
              if (!team) {
                throw new APIError("BAD_REQUEST", { message: "Invited team no longer exists" });
              }
              await tx.insert(schema.teamMember).values({
                id: crypto.randomUUID(),
                teamId,
                userId: user.id,
                createdAt: new Date(),
              });
            }
            const [created] = await tx
              .insert(schema.member)
              .values({
                id: crypto.randomUUID(),
                organizationId: invitation.organizationId,
                userId: user.id,
                role: invitation.role ?? "member",
                createdAt: new Date(),
              })
              .returning();
            return created;
          });

          const updated = await ctx.context.internalAdapter.updateSession(session.token, {
            activeOrganizationId: invitation.organizationId,
            activeTeamId: teamIds.length === 1 ? teamIds[0] : null,
          });
          if (updated) {
            await setSessionCookie(ctx, { session: updated as typeof session, user });
          }
          return ctx.json({ invitation: { ...invitation, status: "accepted" }, member });
        },
      ),
      rejectNearInvitation: createAuthEndpoint(
        "/organization/reject-near-invitation",
        { method: "POST", body: invitationBody, use: [sessionMiddleware] },
        async (ctx) => {
          const invitation = await findClaimableInvitation(
            db,
            ctx.body.invitationId,
            ctx.context.session.user.id,
          );
          const now = new Date();
          const [rejected] = await db
            .update(schema.invitation)
            .set({ status: "rejected" })
            .where(
              and(
                eq(schema.invitation.id, invitation.id),
                eq(schema.invitation.status, "pending"),
                gt(schema.invitation.expiresAt, now),
              ),
            )
            .returning();
          if (!rejected) {
            if (invitation.expiresAt <= now) {
              throw new APIError("BAD_REQUEST", { message: "Invitation has expired" });
            }
            throw new APIError("BAD_REQUEST", { message: "Invitation is no longer pending" });
          }
          return ctx.json({ invitation: { ...invitation, status: "rejected" } });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
