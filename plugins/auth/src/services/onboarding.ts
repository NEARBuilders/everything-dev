import { createHash } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { Context, Effect } from "effect";
import { attemptDb } from "../attempts";
import type { InferOutput } from "../contract";
import * as schema from "../db/schema";
import { rememberActiveOrganization } from "../personal-organization";
import { toDate, toOnboardingSummary } from "../serializers";
import type {
  MembershipPolicyTag,
  OnboardingCodeCipherTag,
  PluginServices,
} from "../service-types";
import {
  AuthenticationRequired,
  type AuthFailure,
  CodeCreateFailed,
  CodeExpired,
  CodeInactive,
  CodeLimitReached,
  CodeNotFound,
  CodeRevoked,
  EventEnded,
  EventTeamCreateFailed,
  NotOrgMember,
  OrgFull,
  OrgRequiresApproval,
  PlatformAdminRequired,
  RedeemOrgMissing,
} from "./domain-errors";
import type { OrganizerCaller, PermissionsService } from "./permissions";

type Db = PluginServices["db"];

const DEFAULT_MAX_USES = 300;
const DEFAULT_EXPIRES_IN_HOURS = 24;

type CodeState = "active" | "revoked" | "expired" | "used-up";

function generateCode(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function codeState(row: typeof schema.onboardingCode.$inferSelect): CodeState {
  if (row.revokedAt) return "revoked";
  if (toDate(row.expiresAt) < new Date()) return "expired";
  if (row.usedCount >= row.maxUses) return "used-up";
  return "active";
}

function monthWindow(month: string | undefined): { month: string; start: Date; end: Date } {
  const resolved = month ?? new Date().toISOString().slice(0, 7);
  const year = Number(resolved.slice(0, 4));
  const monthIndex = Number(resolved.slice(5, 7)) - 1;
  return {
    month: resolved,
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end:
      monthIndex === 11
        ? new Date(Date.UTC(year + 1, 0, 1))
        : new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export class OnboardingService extends Context.Service<
  OnboardingService,
  {
    createOnboardingCode: (
      context: OrganizerCaller,
      input: {
        eventId: string;
        eventName: string;
        organizationId?: string;
        maxUses?: number;
        expiresAt?: Date;
      },
    ) => Effect.Effect<InferOutput<"createOnboardingCode">, AuthFailure>;
    listOnboardingCodes: (
      context: OrganizerCaller,
      input: { organizationId?: string; eventId?: string },
    ) => Effect.Effect<InferOutput<"listOnboardingCodes">, AuthFailure>;
    revokeOnboardingCode: (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    getOnboardingStation: (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) => Effect.Effect<InferOutput<"getOnboardingStation">, AuthFailure>;
    getOnboardingStatus: (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) => Effect.Effect<InferOutput<"getOnboardingStatus">, AuthFailure>;
    getOnboardingStats: (
      context: OrganizerCaller,
      input: { month?: string; organizationId?: string },
    ) => Effect.Effect<InferOutput<"getOnboardingStats">, AuthFailure>;
    getOnboardingCodeInfo: (
      code: string,
    ) => Effect.Effect<InferOutput<"getOnboardingCodeInfo">, AuthFailure>;
    redeemOnboardingCode: (
      context: OrganizerCaller,
      code: string,
    ) => Effect.Effect<InferOutput<"redeemOnboardingCode">, AuthFailure>;
  }
>()("auth/OnboardingService") {}

export const buildOnboardingService = ({
  db,
  permissions,
  cipher,
  membershipPolicy,
}: {
  db: Db;
  permissions: PermissionsService["Service"];
  cipher: OnboardingCodeCipherTag["Service"];
  membershipPolicy: MembershipPolicyTag["Service"];
}) =>
  OnboardingService.of({
    createOnboardingCode: Effect.fn("OnboardingService.createOnboardingCode")(function* (
      context: OrganizerCaller,
      input: {
        eventId: string;
        eventName: string;
        organizationId?: string;
        maxUses?: number;
        expiresAt?: Date;
      },
    ) {
      const { userId, organizationId } = yield* permissions.requireOrganizer(
        context,
        input.organizationId,
      );

      const eventName = String(input.eventName).trim();
      const eventId = String(input.eventId);
      const now = new Date();
      const expiresAt = input.expiresAt
        ? toDate(input.expiresAt)
        : new Date(now.getTime() + DEFAULT_EXPIRES_IN_HOURS * 3_600_000);
      if (expiresAt <= now) {
        return yield* Effect.fail(
          new EventEnded({
            message: "This event has ended, so its onboarding code would already be expired",
          }),
        );
      }

      const teamId = yield* attemptDb(() =>
        resolveEventTeamId(db, organizationId, eventId, eventName),
      );
      const code = generateCode();
      const encryptedCode = yield* Effect.promise(() => cipher.encrypt(code));
      const [row] = yield* attemptDb(() =>
        db
          .insert(schema.onboardingCode)
          .values({
            id: crypto.randomUUID(),
            codeHash: hashCode(code),
            encryptedCode,
            organizationId,
            eventId,
            eventName,
            teamId,
            role: "member",
            maxUses: input.maxUses ?? DEFAULT_MAX_USES,
            usedCount: 0,
            expiresAt,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning(),
      );
      if (!row) {
        return yield* Effect.fail(new CodeCreateFailed({ message: "Failed to create code" }));
      }

      return { ...toOnboardingSummary(row), code };
    }),

    listOnboardingCodes: Effect.fn("OnboardingService.listOnboardingCodes")(function* (
      context: OrganizerCaller,
      input: { organizationId?: string; eventId?: string },
    ) {
      const { organizationId: resolved } = yield* permissions.requireOrganizer(
        context,
        input.organizationId,
      );
      const rows = yield* attemptDb(() =>
        db
          .select()
          .from(schema.onboardingCode)
          .where(
            and(
              eq(schema.onboardingCode.organizationId, resolved),
              input.eventId ? eq(schema.onboardingCode.eventId, input.eventId) : undefined,
            ),
          )
          .orderBy(desc(schema.onboardingCode.createdAt))
          .limit(20),
      );
      return rows.map(toOnboardingSummary);
    }),

    getOnboardingStats: Effect.fn("OnboardingService.getOnboardingStats")(function* (
      context: OrganizerCaller,
      input: { month?: string; organizationId?: string },
    ) {
      const window = monthWindow(input.month);
      let scopedOrganizationId: string | undefined;
      if (input.organizationId) {
        const { organizationId } = yield* permissions.requireOrganizer(
          context,
          input.organizationId,
        );
        scopedOrganizationId = organizationId;
      } else if (context.user?.role !== "admin") {
        return yield* Effect.fail(
          new PlatformAdminRequired({
            message:
              "Viewing onboarding stats across all organizations requires a platform admin; pass organizationId for organization-scoped stats",
          }),
        );
      }

      const rows = yield* attemptDb(() =>
        db
          .select({
            organizationId: schema.onboardingCode.organizationId,
            organizationName: schema.organization.name,
            redeemed: sql<number>`count(*)::int`,
            newMembers: sql<number>`count(distinct ${schema.onboardingRedemption.userId}) filter (where exists (
              select 1 from ${schema.member} member_this_month
              where member_this_month.user_id = ${schema.onboardingRedemption.userId}
                and member_this_month.organization_id = ${schema.onboardingCode.organizationId}
                and member_this_month.created_at >= ${window.start}
                and member_this_month.created_at < ${window.end}
            ))::int`,
          })
          .from(schema.onboardingRedemption)
          .innerJoin(
            schema.onboardingCode,
            eq(schema.onboardingRedemption.codeId, schema.onboardingCode.id),
          )
          .leftJoin(
            schema.organization,
            eq(schema.organization.id, schema.onboardingCode.organizationId),
          )
          .where(
            and(
              gte(schema.onboardingRedemption.createdAt, window.start),
              lt(schema.onboardingRedemption.createdAt, window.end),
              scopedOrganizationId
                ? eq(schema.onboardingCode.organizationId, scopedOrganizationId)
                : undefined,
            ),
          )
          .groupBy(schema.onboardingCode.organizationId, schema.organization.name)
          .orderBy(schema.onboardingCode.organizationId),
      );

      const organizations = rows.map((row) => ({
        organizationId: row.organizationId,
        organizationName: row.organizationName ?? null,
        redeemed: row.redeemed,
        newMembers: row.newMembers,
      }));
      return {
        month: window.month,
        totals: {
          redeemed: organizations.reduce((sum, org) => sum + org.redeemed, 0),
          newMembers: organizations.reduce((sum, org) => sum + org.newMembers, 0),
        },
        organizations,
      };
    }),

    revokeOnboardingCode: Effect.fn("OnboardingService.revokeOnboardingCode")(function* (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) {
      const { organizationId } = yield* permissions.requireOrganizer(context, input.organizationId);
      const [revoked] = yield* attemptDb(() =>
        db
          .update(schema.onboardingCode)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.onboardingCode.id, input.codeId),
              eq(schema.onboardingCode.organizationId, organizationId),
              sql`${schema.onboardingCode.revokedAt} is null`,
            ),
          )
          .returning(),
      );
      if (!revoked) {
        return yield* Effect.fail(
          new CodeNotFound({ message: "Onboarding code not found", codeId: input.codeId }),
        );
      }
      return { success: true };
    }),

    getOnboardingStation: Effect.fn("OnboardingService.getOnboardingStation")(function* (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) {
      const { organizationId } = yield* permissions.requireOrganizer(context, input.organizationId);
      const row = yield* attemptDb(() =>
        db.query.onboardingCode.findFirst({
          where: and(
            eq(schema.onboardingCode.id, input.codeId),
            eq(schema.onboardingCode.organizationId, organizationId),
          ),
        }),
      );
      if (!row) {
        return yield* Effect.fail(
          new CodeNotFound({ message: "Onboarding code not found", codeId: input.codeId }),
        );
      }
      if (!row.encryptedCode || codeState(row) !== "active") {
        return yield* Effect.fail(
          new CodeInactive({ message: "This onboarding code is no longer active" }),
        );
      }

      const encryptedCode = row.encryptedCode;
      return {
        ...toOnboardingSummary(row),
        code: yield* Effect.promise(() => cipher.decrypt(encryptedCode)),
      };
    }),

    getOnboardingStatus: Effect.fn("OnboardingService.getOnboardingStatus")(function* (
      context: OrganizerCaller,
      input: { organizationId?: string; codeId: string },
    ) {
      const { organizationId } = yield* permissions.requireOrganizer(context, input.organizationId);
      const row = yield* attemptDb(() =>
        db.query.onboardingCode.findFirst({
          where: and(
            eq(schema.onboardingCode.id, input.codeId),
            eq(schema.onboardingCode.organizationId, organizationId),
          ),
        }),
      );
      if (!row) {
        return yield* Effect.fail(
          new CodeNotFound({ message: "Onboarding code not found", codeId: input.codeId }),
        );
      }

      const joined = yield* attemptDb(() =>
        db
          .select({
            userId: schema.onboardingRedemption.userId,
            userName: schema.user.name,
            accountId: schema.nearAccount.accountId,
            createdAt: schema.onboardingRedemption.createdAt,
          })
          .from(schema.onboardingRedemption)
          .innerJoin(schema.user, eq(schema.onboardingRedemption.userId, schema.user.id))
          .leftJoin(
            schema.nearAccount,
            and(
              eq(schema.nearAccount.userId, schema.user.id),
              eq(schema.nearAccount.isPrimary, true),
            ),
          )
          .where(eq(schema.onboardingRedemption.codeId, row.id))
          .orderBy(desc(schema.onboardingRedemption.createdAt)),
      );

      return {
        ...toOnboardingSummary(row),
        joined: joined.map((entry) => ({
          userId: entry.userId,
          userName: entry.userName ?? null,
          accountId: entry.accountId ?? null,
          createdAt: toDate(entry.createdAt),
        })),
      };
    }),

    getOnboardingCodeInfo: Effect.fn("OnboardingService.getOnboardingCodeInfo")(function* (
      code: string,
    ) {
      const codeRow = yield* attemptDb(() =>
        db.query.onboardingCode.findFirst({
          where: eq(schema.onboardingCode.codeHash, hashCode(code)),
        }),
      );
      if (!codeRow) return null;

      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, codeRow.organizationId),
        }),
      );
      const inviter = yield* attemptDb(() =>
        db.query.user.findFirst({
          where: eq(schema.user.id, codeRow.createdBy),
        }),
      );

      const state = codeState(codeRow);
      return {
        organizationName: organization?.name ?? "",
        eventName: codeRow.eventName,
        inviterName: inviter?.name ?? null,
        role: codeRow.role,
        expired: state === "expired",
        revoked: state === "revoked",
        usedUp: state === "used-up",
      };
    }),

    redeemOnboardingCode: Effect.fn("OnboardingService.redeemOnboardingCode")(function* (
      context: OrganizerCaller,
      code: string,
    ) {
      const userId = context.userId;
      const sessionId = context.sessionId ?? null;
      if (!userId || !sessionId) {
        return yield* Effect.fail(
          new AuthenticationRequired({ message: "Authentication required" }),
        );
      }

      const codeRow = yield* attemptDb(() =>
        db.query.onboardingCode.findFirst({
          where: eq(schema.onboardingCode.codeHash, hashCode(code)),
        }),
      );
      if (!codeRow) {
        return yield* Effect.fail(new CodeNotFound({ message: "Onboarding code not found" }));
      }

      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, codeRow.organizationId),
        }),
      );
      const organizationName = organization?.name ?? "";
      if (organization?.status !== "active") {
        return yield* Effect.fail(
          new OrgRequiresApproval({ message: "Organization requires platform-admin approval" }),
        );
      }

      if (codeRow.revokedAt) {
        return yield* Effect.fail(new CodeRevoked({ message: "This onboarding code was revoked" }));
      }
      if (toDate(codeRow.expiresAt) < new Date()) {
        return yield* Effect.fail(new CodeExpired({ message: "This onboarding code has expired" }));
      }
      if (codeRow.usedCount >= codeRow.maxUses) {
        return yield* Effect.fail(
          new CodeLimitReached({ message: "This onboarding code has reached its limit" }),
        );
      }

      const already = yield* attemptDb(() =>
        db.query.onboardingRedemption.findFirst({
          where: and(
            eq(schema.onboardingRedemption.codeId, codeRow.id),
            eq(schema.onboardingRedemption.userId, userId),
          ),
        }),
      );
      if (already) {
        const membership = yield* attemptDb(() =>
          db.query.member.findFirst({
            where: and(
              eq(schema.member.userId, userId),
              eq(schema.member.organizationId, codeRow.organizationId),
            ),
          }),
        );
        if (!membership) {
          return yield* new NotOrgMember({
            message: "You are no longer a member of this organization",
          });
        }
        yield* attemptDb(() =>
          db
            .update(schema.session)
            .set({ activeOrganizationId: codeRow.organizationId })
            .where(eq(schema.session.id, sessionId)),
        );
        yield* attemptDb(() => rememberActiveOrganization(db, userId, codeRow.organizationId));
        return {
          success: true,
          alreadyRedeemed: true,
          organizationId: codeRow.organizationId,
          organizationName,
          eventName: codeRow.eventName,
        };
      }

      yield* attemptDb(() =>
        db.transaction(async (tx) => {
          const [orgRow] = await tx
            .select({ id: schema.organization.id })
            .from(schema.organization)
            .where(eq(schema.organization.id, codeRow.organizationId))
            .for("update");
          if (!orgRow) {
            throw new RedeemOrgMissing({ message: "Organization not found" });
          }

          const existingMember = await tx.query.member.findFirst({
            where: and(
              eq(schema.member.userId, userId),
              eq(schema.member.organizationId, codeRow.organizationId),
            ),
          });
          if (!existingMember) {
            const [{ memberCount } = { memberCount: 0 }] = await tx
              .select({ memberCount: sql<number>`count(*)::int` })
              .from(schema.member)
              .where(eq(schema.member.organizationId, codeRow.organizationId));
            if (!membershipPolicy.hasCapacity(memberCount)) {
              throw new OrgFull({
                message: "This organization is full, so no more members can join",
              });
            }
            await tx.insert(schema.member).values({
              id: crypto.randomUUID(),
              organizationId: codeRow.organizationId,
              userId,
              role: codeRow.role,
              createdAt: new Date(),
            });
          }

          const team = await tx.query.team.findFirst({
            where: and(
              eq(schema.team.id, codeRow.teamId),
              eq(schema.team.organizationId, codeRow.organizationId),
            ),
          });
          if (team) {
            const existingTeamMember = await tx.query.teamMember.findFirst({
              where: and(
                eq(schema.teamMember.teamId, team.id),
                eq(schema.teamMember.userId, userId),
              ),
            });
            if (!existingTeamMember) {
              await tx.insert(schema.teamMember).values({
                id: crypto.randomUUID(),
                teamId: team.id,
                userId,
                createdAt: new Date(),
              });
            }
          }

          const [updated] = await tx
            .update(schema.onboardingCode)
            .set({
              usedCount: sql`${schema.onboardingCode.usedCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.onboardingCode.id, codeRow.id),
                sql`${schema.onboardingCode.usedCount} < ${schema.onboardingCode.maxUses}`,
              ),
            )
            .returning();
          if (!updated) {
            throw new CodeLimitReached({
              message: "This onboarding code has reached its limit",
            });
          }

          await tx.insert(schema.onboardingRedemption).values({
            id: crypto.randomUUID(),
            codeId: codeRow.id,
            userId,
            createdAt: new Date(),
          });
        }),
      );

      yield* attemptDb(() =>
        db
          .update(schema.session)
          .set({ activeOrganizationId: codeRow.organizationId })
          .where(eq(schema.session.id, sessionId)),
      );
      yield* attemptDb(() => rememberActiveOrganization(db, userId, codeRow.organizationId));

      return {
        success: true,
        alreadyRedeemed: false,
        organizationId: codeRow.organizationId,
        organizationName,
        eventName: codeRow.eventName,
      };
    }),
  });

async function resolveEventTeamId(
  db: Db,
  organizationId: string,
  eventId: string,
  eventName: string,
): Promise<string> {
  const [prior] = await db
    .select({ teamId: schema.onboardingCode.teamId })
    .from(schema.onboardingCode)
    .where(
      and(
        eq(schema.onboardingCode.organizationId, organizationId),
        eq(schema.onboardingCode.eventId, eventId),
      ),
    )
    .orderBy(desc(schema.onboardingCode.createdAt))
    .limit(1);
  if (prior) return prior.teamId;

  const now = new Date();
  const [team] = await db
    .insert(schema.team)
    .values({
      id: crypto.randomUUID(),
      name: eventName,
      organizationId,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!team) {
    throw new EventTeamCreateFailed({ message: "Failed to create event team" });
  }
  return team.id;
}
