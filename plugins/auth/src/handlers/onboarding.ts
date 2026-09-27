import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { Context } from "effect";
import * as schema from "../db/schema";
import {
  createOrganizationMembershipPolicy,
  type OrganizationMembershipPolicy,
} from "../organization-membership-policy";
import { AuthServicesTag, type PluginServices } from "../service-types";
import { createHeaders, getActiveOrganizationId, parseTeamAreas, safeAuthApi } from "../utils";

const DEFAULT_MAX_USES = 50;
const DEFAULT_EXPIRES_IN_HOURS = 24;
const EVENTS_AREA = "events";

function generateCode(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function membershipPolicyOf(services: {
  membershipPolicy?: OrganizationMembershipPolicy;
}): OrganizationMembershipPolicy {
  return services.membershipPolicy ?? createOrganizationMembershipPolicy();
}

async function requireOrganizerContext(
  services: any,
  context: any,
  inputOrganizationId?: string,
): Promise<{ userId: string; organizationId: string; headers: Headers }> {
  const headers = createHeaders(context.reqHeaders);
  const session = await safeAuthApi(() => services.auth.api.getSession({ headers }));
  const sessionData = session as {
    user?: { id?: string };
    session?: { activeOrganizationId?: string | null };
  } | null;
  const userId = context.userId ?? sessionData?.user?.id ?? null;
  const organizationId =
    inputOrganizationId ?? getActiveOrganizationId(sessionData?.session) ?? null;
  if (!userId || !organizationId) {
    throw new ORPCError("BAD_REQUEST", { message: "No organization selected" });
  }
  const result = await safeAuthApi(() =>
    services.auth.api.getActiveMemberRole({
      headers,
      query: { organizationId },
    }),
  );
  const role = typeof result === "string" ? result : ((result as any)?.role ?? null);
  const isOrganizer =
    role === "owner" ||
    role === "admin" ||
    (role !== null && (await belongsToEventsTeam(services.db, userId, organizationId)));
  if (!isOrganizer) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Only organizers — organization owners, admins, or members of a team with the events area — can manage onboarding codes",
    });
  }
  return { userId, organizationId, headers };
}

async function belongsToEventsTeam(
  db: PluginServices["db"],
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const teams = await db
    .select({ metadata: schema.team.metadata })
    .from(schema.teamMember)
    .innerJoin(schema.team, eq(schema.teamMember.teamId, schema.team.id))
    .where(
      and(eq(schema.teamMember.userId, userId), eq(schema.team.organizationId, organizationId)),
    );
  return teams.some((team) => parseTeamAreas(team.metadata).includes(EVENTS_AREA));
}

async function resolveEventTeamId(
  db: PluginServices["db"],
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
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create event team" });
  }
  return team.id;
}

function codeState(
  row: typeof schema.onboardingCode.$inferSelect,
): "active" | "revoked" | "expired" | "used-up" {
  if (row.revokedAt) return "revoked";
  if (toDate(row.expiresAt) < new Date()) return "expired";
  if (row.usedCount >= row.maxUses) return "used-up";
  return "active";
}

function toSummary(row: typeof schema.onboardingCode.$inferSelect) {
  return {
    id: row.id,
    eventId: row.eventId,
    eventName: row.eventName,
    teamId: row.teamId,
    role: row.role,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: toDate(row.expiresAt),
    revokedAt: row.revokedAt ? toDate(row.revokedAt) : null,
    createdAt: toDate(row.createdAt),
  };
}

export function createOnboardingHandlers(builder: any, requireAuth: any) {
  return {
    createOnboardingCode: builder.createOnboardingCode
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const { userId, organizationId } = await requireOrganizerContext(
          services,
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
          throw new ORPCError("BAD_REQUEST", {
            message: "This event has ended, so its onboarding code would already be expired",
          });
        }

        const teamId = await resolveEventTeamId(services.db, organizationId, eventId, eventName);
        const code = generateCode();
        const [row] = await services.db
          .insert(schema.onboardingCode)
          .values({
            id: crypto.randomUUID(),
            codeHash: hashCode(code),
            encryptedCode: await services.onboardingCodeCipher.encrypt(code),
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
          .returning();
        if (!row) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create code" });
        }

        return { ...toSummary(row), code };
      }),

    listOnboardingCodes: builder.listOnboardingCodes
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const { organizationId } = await requireOrganizerContext(
          services,
          context,
          input.organizationId,
        );

        const rows = await services.db
          .select()
          .from(schema.onboardingCode)
          .where(eq(schema.onboardingCode.organizationId, organizationId))
          .orderBy(desc(schema.onboardingCode.createdAt))
          .limit(20);
        return rows.map(toSummary);
      }),

    revokeOnboardingCode: builder.revokeOnboardingCode
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const { organizationId } = await requireOrganizerContext(
          services,
          context,
          input.organizationId,
        );

        const [revoked] = await services.db
          .update(schema.onboardingCode)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.onboardingCode.id, input.codeId),
              eq(schema.onboardingCode.organizationId, organizationId),
              sql`${schema.onboardingCode.revokedAt} is null`,
            ),
          )
          .returning();
        if (!revoked) {
          throw new ORPCError("NOT_FOUND", { message: "Onboarding code not found" });
        }
        return { success: true };
      }),

    getOnboardingStation: builder.getOnboardingStation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const { organizationId } = await requireOrganizerContext(
          services,
          context,
          input.organizationId,
        );

        const row = await services.db.query.onboardingCode.findFirst({
          where: and(
            eq(schema.onboardingCode.id, input.codeId),
            eq(schema.onboardingCode.organizationId, organizationId),
          ),
        });
        if (!row) {
          throw new ORPCError("NOT_FOUND", { message: "Onboarding code not found" });
        }
        if (!row.encryptedCode || codeState(row) !== "active") {
          throw new ORPCError("BAD_REQUEST", {
            message: "This onboarding code is no longer active",
          });
        }

        return {
          ...toSummary(row),
          code: await services.onboardingCodeCipher.decrypt(row.encryptedCode),
        };
      }),

    getOnboardingStatus: builder.getOnboardingStatus
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const { organizationId } = await requireOrganizerContext(
          services,
          context,
          input.organizationId,
        );

        const row = await services.db.query.onboardingCode.findFirst({
          where: and(
            eq(schema.onboardingCode.id, input.codeId),
            eq(schema.onboardingCode.organizationId, organizationId),
          ),
        });
        if (!row) {
          throw new ORPCError("NOT_FOUND", { message: "Onboarding code not found" });
        }

        const joined = await services.db
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
          .orderBy(desc(schema.onboardingRedemption.createdAt));

        return {
          ...toSummary(row),
          joined: joined.map((entry) => ({
            userId: entry.userId,
            userName: entry.userName ?? null,
            accountId: entry.accountId ?? null,
            createdAt: toDate(entry.createdAt),
          })),
        };
      }),

    getOnboardingCodeInfo: builder.getOnboardingCodeInfo.handler(
      async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const codeRow = await services.db.query.onboardingCode.findFirst({
          where: eq(schema.onboardingCode.codeHash, hashCode(input.code)),
        });
        if (!codeRow) return null;

        const organization = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, codeRow.organizationId),
        });
        const inviter = await services.db.query.user.findFirst({
          where: eq(schema.user.id, codeRow.createdBy),
        });

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
      },
    ),

    redeemOnboardingCode: builder.redeemOnboardingCode
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders);
        const session = await safeAuthApi(() => services.auth.api.getSession({ headers }));
        const sessionData = session as { user?: { id?: string }; session?: { id?: string } } | null;
        const userId = context.userId ?? sessionData?.user?.id ?? null;
        if (!userId || !sessionData?.session?.id) {
          throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
        }

        const codeRow = await services.db.query.onboardingCode.findFirst({
          where: eq(schema.onboardingCode.codeHash, hashCode(input.code)),
        });
        if (!codeRow) {
          throw new ORPCError("NOT_FOUND", { message: "Onboarding code not found" });
        }

        const organization = await services.db.query.organization.findFirst({
          where: eq(schema.organization.id, codeRow.organizationId),
        });
        const organizationName = organization?.name ?? "";

        if (codeRow.revokedAt) {
          throw new ORPCError("FORBIDDEN", { message: "This onboarding code was revoked" });
        }
        if (toDate(codeRow.expiresAt) < new Date()) {
          throw new ORPCError("BAD_REQUEST", { message: "This onboarding code has expired" });
        }
        if (codeRow.usedCount >= codeRow.maxUses) {
          throw new ORPCError("FORBIDDEN", {
            message: "This onboarding code has reached its limit",
          });
        }

        const already = await services.db.query.onboardingRedemption.findFirst({
          where: and(
            eq(schema.onboardingRedemption.codeId, codeRow.id),
            eq(schema.onboardingRedemption.userId, userId),
          ),
        });
        if (already) {
          return {
            success: true,
            alreadyRedeemed: true,
            organizationName,
            eventName: codeRow.eventName,
          };
        }

        await services.db.transaction(async (tx) => {
          const [orgRow] = await tx
            .select({ id: schema.organization.id })
            .from(schema.organization)
            .where(eq(schema.organization.id, codeRow.organizationId))
            .for("update");
          if (!orgRow) {
            throw new ORPCError("BAD_REQUEST", { message: "Organization not found" });
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
            if (!membershipPolicyOf(services).hasCapacity(memberCount)) {
              throw new ORPCError("FORBIDDEN", {
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
            throw new ORPCError("FORBIDDEN", {
              message: "This onboarding code has reached its limit",
            });
          }

          await tx.insert(schema.onboardingRedemption).values({
            id: crypto.randomUUID(),
            codeId: codeRow.id,
            userId,
            createdAt: new Date(),
          });
        });

        await services.db
          .update(schema.session)
          .set({ activeOrganizationId: codeRow.organizationId })
          .where(eq(schema.session.id, sessionData.session.id));

        return {
          success: true,
          alreadyRedeemed: false,
          organizationName,
          eventName: codeRow.eventName,
        };
      }),
  };
}
