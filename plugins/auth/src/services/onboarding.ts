import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import type { InferOutput } from "../contract";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { toDate, toOnboardingSummary } from "../serializers";
import {
  AuthApiTag,
  MembershipPolicyTag,
  OnboardingCodeCipherTag,
  type PluginServices,
} from "../service-types";
import { createHeaders } from "../utils";
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
  OrgFull,
  OrgRequiresApproval,
  RedeemOrgMissing,
} from "./domain-errors";
import { type OrganizerCaller, PermissionsService } from "./permissions";

type Auth = PluginServices["auth"];
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
      organizationId: string | undefined,
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
  auth,
  db,
  permissions,
  cipher,
  membershipPolicy,
}: {
  auth: Auth;
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
      organizationId: string | undefined,
    ) {
      const { organizationId: resolved } = yield* permissions.requireOrganizer(
        context,
        organizationId,
      );
      const rows = yield* attemptDb(() =>
        db
          .select()
          .from(schema.onboardingCode)
          .where(eq(schema.onboardingCode.organizationId, resolved))
          .orderBy(desc(schema.onboardingCode.createdAt))
          .limit(20),
      );
      return rows.map(toOnboardingSummary);
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
      const headers = createHeaders(context.reqHeaders);
      const session = yield* attemptAuth(() => auth.api.getSession({ headers }));
      const sessionData = session as { user?: { id?: string }; session?: { id?: string } } | null;
      const userId = context.userId ?? sessionData?.user?.id ?? null;
      if (!userId || !sessionData?.session?.id) {
        return yield* Effect.fail(
          new AuthenticationRequired({ message: "Authentication required" }),
        );
      }
      const sessionId = sessionData.session.id;

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
        yield* attemptDb(() =>
          db
            .update(schema.session)
            .set({ activeOrganizationId: codeRow.organizationId })
            .where(eq(schema.session.id, sessionId)),
        );
        return {
          success: true,
          alreadyRedeemed: true,
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

      return {
        success: true,
        alreadyRedeemed: false,
        organizationName,
        eventName: codeRow.eventName,
      };
    }),
  });

export const OnboardingServiceLive = Layer.effect(
  OnboardingService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    const permissions = yield* PermissionsService;
    const cipher = yield* OnboardingCodeCipherTag;
    const membershipPolicy = yield* MembershipPolicyTag;
    return buildOnboardingService({ auth, db, permissions, cipher, membershipPolicy });
  }),
);

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
