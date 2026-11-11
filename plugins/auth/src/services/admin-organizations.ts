import { and, desc, eq, ilike, inArray, isNull, like, notLike, or, sql } from "drizzle-orm";
import { Context, Effect } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import type { InferInput, InferOutput } from "../contract";
import * as schema from "../db/schema";
import { toDate, toInvitation, toOrganizationInfo, toTeam } from "../serializers";
import type { PermissionRegistry, PluginServices } from "../service-types";
import { parseMemberRoles } from "../utils";
import {
  AuthApiError,
  type AuthFailure,
  MemberNotFound,
  OrgNotFound,
  TeamMemberNotFound,
  TeamNotFound,
  TeamUpdateFailed,
  UnknownTeamRole,
  UserNotFound,
} from "./domain-errors";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

type AdminListOrganizationsInput = InferInput<"adminListOrganizations">;

export class AdminOrganizationsService extends Context.Service<
  AdminOrganizationsService,
  {
    listOrganizations: (
      input: AdminListOrganizationsInput,
    ) => Effect.Effect<InferOutput<"adminListOrganizations">, AuthFailure>;
    getOrganizationFull: (
      organizationId: string,
    ) => Effect.Effect<InferOutput<"adminGetOrganizationFull">, AuthFailure>;
    createOrganizationForUser: (
      input: InferInput<"adminCreateOrganizationForUser">,
    ) => Effect.Effect<InferOutput<"adminCreateOrganizationForUser">, AuthFailure>;
    updateOrganization: (
      input: InferInput<"adminUpdateOrganization">,
    ) => Effect.Effect<InferOutput<"adminUpdateOrganization">, AuthFailure>;
    deleteOrganization: (
      organizationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    addMember: (
      headers: Headers,
      input: InferInput<"adminAddMember">,
    ) => Effect.Effect<InferOutput<"adminAddMember">, AuthFailure>;
    removeMember: (
      input: InferInput<"adminRemoveMember">,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    updateMemberRole: (
      input: InferInput<"adminUpdateMemberRole">,
    ) => Effect.Effect<InferOutput<"adminUpdateMemberRole">, AuthFailure>;
    createTeam: (
      input: InferInput<"adminCreateTeam">,
    ) => Effect.Effect<InferOutput<"adminCreateTeam">, AuthFailure>;
    updateTeam: (
      input: InferInput<"adminUpdateTeam">,
    ) => Effect.Effect<InferOutput<"adminUpdateTeam">, AuthFailure>;
    deleteTeam: (teamId: string) => Effect.Effect<{ success: boolean }, AuthFailure>;
    addTeamMember: (
      input: InferInput<"adminAddTeamMember">,
    ) => Effect.Effect<InferOutput<"adminAddTeamMember">, AuthFailure>;
    removeTeamMember: (
      input: InferInput<"adminRemoveTeamMember">,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
  }
>()("auth/AdminOrganizationsService") {}

export const buildAdminOrganizationsService = ({
  auth,
  db,
  registry,
}: {
  auth: Auth;
  db: Db;
  registry: PermissionRegistry;
}) => {
  const notFound = (organizationId: string) =>
    new OrgNotFound({ message: "Organization not found", organizationId });

  const slugTaken = (slug: string) =>
    new AuthApiError({
      code: "BAD_REQUEST",
      data: {},
      message: `Organization slug "${slug}" is already in use`,
    });

  const slugAvailable = (slug: string) =>
    attemptAuth(() => auth.api.checkOrganizationSlug({ body: { slug } })).pipe(
      Effect.map((result) => result.status),
      Effect.catchIf(
        (error) => error instanceof AuthApiError && error.code === "BAD_REQUEST",
        () => Effect.succeed(false as const),
      ),
    );

  const syncTeamMemberCount = (teamId: string) =>
    attemptDb(async () => {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.teamMember)
        .where(eq(schema.teamMember.teamId, teamId));
      await db.update(schema.team).set({ memberCount: count }).where(eq(schema.team.id, teamId));
    });

  return AdminOrganizationsService.of({
    listOrganizations: (input) =>
      Effect.gen(function* () {
        const conditions = [];
        if (input?.search) {
          const pattern = `%${input.search}%`;
          conditions.push(
            or(
              ilike(schema.organization.name, pattern),
              ilike(schema.organization.slug, pattern),
              ilike(schema.organization.id, pattern),
            ),
          );
        }
        if (input?.status) {
          conditions.push(eq(schema.organization.status, input.status));
        }
        if (input?.personal !== undefined) {
          const personalPattern = '%"isPersonal":true%';
          conditions.push(
            input.personal
              ? like(schema.organization.metadata, personalPattern)
              : or(
                  isNull(schema.organization.metadata),
                  notLike(schema.organization.metadata, personalPattern),
                ),
          );
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const organizations = yield* attemptDb(() =>
          db
            .select({
              id: schema.organization.id,
              name: schema.organization.name,
              slug: schema.organization.slug,
              logo: schema.organization.logo,
              metadata: schema.organization.metadata,
              status: schema.organization.status,
              createdAt: schema.organization.createdAt,
              memberCount: sql<number>`(select count(*)::int from "member" "m" where "m"."organization_id" = "organization"."id")`,
              teamCount: sql<number>`(select count(*)::int from "team" "t" where "t"."organization_id" = "organization"."id")`,
            })
            .from(schema.organization)
            .where(where)
            .orderBy(desc(schema.organization.createdAt))
            .limit(input?.limit ?? 20)
            .offset(input?.offset ?? 0),
        );

        const [{ total } = { total: 0 }] = yield* attemptDb(() =>
          db.select({ total: sql<number>`count(*)::int` }).from(schema.organization).where(where),
        );

        return {
          organizations: organizations.map((organization) => ({
            ...toOrganizationInfo(organization),
            createdAt: toDate(organization.createdAt),
            memberCount: organization.memberCount,
            teamCount: organization.teamCount,
          })),
          total,
        };
      }),

    getOrganizationFull: Effect.fn("AdminOrganizationsService.getOrganizationFull")(function* (
      organizationId: string,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(organizationId);
      }

      const members = yield* attemptDb(() =>
        db
          .select({
            id: schema.member.id,
            userId: schema.member.userId,
            organizationId: schema.member.organizationId,
            role: schema.member.role,
            createdAt: schema.member.createdAt,
            user: {
              id: schema.user.id,
              name: schema.user.name,
              email: schema.user.email,
              image: schema.user.image,
            },
          })
          .from(schema.member)
          .leftJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(eq(schema.member.organizationId, organizationId)),
      );

      const invitations = yield* attemptDb(() =>
        db.query.invitation.findMany({
          where: eq(schema.invitation.organizationId, organizationId),
        }),
      );

      const teams = yield* attemptDb(() =>
        db.query.team.findMany({
          where: eq(schema.team.organizationId, organizationId),
        }),
      );

      return {
        ...toOrganizationInfo(organization),
        createdAt: toDate(organization.createdAt),
        members: members.map((member) => ({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: toDate(member.createdAt),
          user: member.user?.id
            ? {
                id: member.user.id,
                name: member.user.name,
                email: member.user.email,
                image: member.user.image ?? null,
              }
            : null,
        })),
        invitations: invitations.map(toInvitation),
        teams: teams.map(toTeam),
      };
    }),

    createOrganizationForUser: Effect.fn("AdminOrganizationsService.createOrganizationForUser")(
      function* (input: InferInput<"adminCreateOrganizationForUser">) {
        const user = yield* attemptDb(() =>
          db.query.user.findFirst({ where: eq(schema.user.id, input.userId) }),
        );
        if (!user) {
          return yield* new UserNotFound({
            message: `User not found: ${input.userId}`,
            userId: input.userId,
          });
        }

        let slug = input.slug;
        if (slug === undefined) {
          const baseSlug =
            input.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "organization";
          slug = baseSlug;
          for (let attempt = 0; attempt < 5; attempt++) {
            if (yield* slugAvailable(slug)) break;
            slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
          }
        } else if (!(yield* slugAvailable(slug))) {
          return yield* slugTaken(slug);
        }

        const result = yield* attemptAuth(() =>
          auth.api.createOrganization({
            body: {
              name: input.name,
              slug,
              userId: input.userId,
              logo: input.logo,
              metadata: input.metadata,
            },
          }),
        ).pipe(
          Effect.map((created: any) => ({
            ...toOrganizationInfo(created),
            createdAt: toDate(created.createdAt),
          })),
        );
        return result;
      },
    ),

    updateOrganization: Effect.fn("AdminOrganizationsService.updateOrganization")(function* (
      input: InferInput<"adminUpdateOrganization">,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(input.organizationId);
      }

      if (input.data.slug !== undefined && input.data.slug !== organization.slug) {
        const existing = yield* attemptDb(() =>
          db.query.organization.findFirst({
            where: eq(schema.organization.slug, input.data.slug!),
          }),
        );
        if (existing && existing.id !== organization.id) {
          return yield* slugTaken(input.data.slug);
        }
      }

      const updates = {
        ...(input.data.name !== undefined ? { name: input.data.name } : {}),
        ...(input.data.slug !== undefined ? { slug: input.data.slug } : {}),
        ...(input.data.logo !== undefined ? { logo: input.data.logo } : {}),
        ...(input.data.status !== undefined ? { status: input.data.status } : {}),
        ...(input.data.metadata !== undefined
          ? { metadata: JSON.stringify(input.data.metadata) }
          : {}),
      };
      if (Object.keys(updates).length === 0) {
        return toOrganizationInfo(organization);
      }

      const [updated] = yield* attemptDb(() =>
        db
          .update(schema.organization)
          .set(updates)
          .where(eq(schema.organization.id, input.organizationId))
          .returning(),
      );
      if (!updated) {
        return yield* notFound(input.organizationId);
      }
      return toOrganizationInfo(updated);
    }),

    deleteOrganization: Effect.fn("AdminOrganizationsService.deleteOrganization")(function* (
      organizationId: string,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(organizationId);
      }

      yield* attemptDb(() =>
        db
          .update(schema.session)
          .set({ activeOrganizationId: null, activeTeamId: null })
          .where(eq(schema.session.activeOrganizationId, organizationId)),
      );
      yield* attemptDb(() =>
        db.delete(schema.organization).where(eq(schema.organization.id, organizationId)),
      );
      return { success: true };
    }),

    addMember: (headers, input) =>
      attemptAuth(() =>
        auth.api.addMember({
          headers,
          body: {
            userId: input.userId,
            role: input.role,
            organizationId: input.organizationId,
          },
        }),
      ).pipe(
        Effect.map((member: any) => ({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: toDate(member.createdAt),
        })),
      ),

    removeMember: Effect.fn("AdminOrganizationsService.removeMember")(function* (
      input: InferInput<"adminRemoveMember">,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(input.organizationId);
      }

      const member = yield* attemptDb(() =>
        db.query.member.findFirst({
          where: and(
            eq(schema.member.organizationId, input.organizationId),
            eq(schema.member.userId, input.userId),
          ),
        }),
      );
      if (!member) {
        return yield* new MemberNotFound({ message: "Member not found" });
      }

      const members = yield* attemptDb(() =>
        db.query.member.findMany({
          where: eq(schema.member.organizationId, input.organizationId),
          columns: { role: true },
        }),
      );
      const owners = members.filter((row) => parseMemberRoles(row.role).includes("owner"));
      if (parseMemberRoles(member.role).includes("owner") && owners.length <= 1) {
        return yield* new AuthApiError({
          code: "BAD_REQUEST",
          data: {},
          message: "Cannot remove the only owner of an organization",
        });
      }

      const orgTeams = yield* attemptDb(() =>
        db
          .select({ id: schema.team.id })
          .from(schema.team)
          .where(eq(schema.team.organizationId, input.organizationId)),
      );
      if (orgTeams.length > 0) {
        const teamIds = orgTeams.map((team) => team.id);
        const affectedTeams = yield* attemptDb(() =>
          db
            .select({ teamId: schema.teamMember.teamId })
            .from(schema.teamMember)
            .where(
              and(
                eq(schema.teamMember.userId, input.userId),
                inArray(schema.teamMember.teamId, teamIds),
              ),
            ),
        );
        yield* attemptDb(() =>
          db
            .delete(schema.teamMember)
            .where(
              and(
                eq(schema.teamMember.userId, input.userId),
                inArray(schema.teamMember.teamId, teamIds),
              ),
            ),
        );
        for (const { teamId } of affectedTeams) {
          yield* syncTeamMemberCount(teamId);
        }
      }

      yield* attemptDb(() => db.delete(schema.member).where(eq(schema.member.id, member.id)));
      return { success: true };
    }),

    updateMemberRole: Effect.fn("AdminOrganizationsService.updateMemberRole")(function* (
      input: InferInput<"adminUpdateMemberRole">,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(input.organizationId);
      }

      const member = yield* attemptDb(() =>
        db.query.member.findFirst({
          where: and(
            eq(schema.member.organizationId, input.organizationId),
            eq(schema.member.userId, input.userId),
          ),
        }),
      );
      if (!member) {
        return yield* new MemberNotFound({ message: "Member not found" });
      }

      const [updated] = yield* attemptDb(() =>
        db
          .update(schema.member)
          .set({ role: input.role })
          .where(eq(schema.member.id, member.id))
          .returning(),
      );
      if (!updated) {
        return yield* new MemberNotFound({ message: "Member not found", memberId: member.id });
      }
      return {
        id: updated.id,
        userId: updated.userId,
        organizationId: updated.organizationId,
        role: updated.role,
        createdAt: toDate(updated.createdAt),
      };
    }),

    createTeam: Effect.fn("AdminOrganizationsService.createTeam")(function* (
      input: InferInput<"adminCreateTeam">,
    ) {
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, input.organizationId),
        }),
      );
      if (!organization) {
        return yield* notFound(input.organizationId);
      }

      if (input.eventId !== undefined) {
        const existing = yield* attemptDb(() =>
          db.query.team.findFirst({
            where: and(
              eq(schema.team.organizationId, input.organizationId),
              eq(schema.team.eventId, input.eventId!),
            ),
          }),
        );
        if (existing) {
          return yield* new AuthApiError({
            code: "BAD_REQUEST",
            data: {},
            message: `Event "${input.eventId}" already has a team in this organization`,
          });
        }
      }

      const now = new Date();
      const [team] = yield* attemptDb(() =>
        db
          .insert(schema.team)
          .values({
            id: crypto.randomUUID(),
            name: input.name,
            organizationId: input.organizationId,
            eventId: input.eventId ?? null,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning(),
      );
      if (!team) {
        return yield* new TeamUpdateFailed({ message: "Team creation failed" });
      }
      return toTeam(team);
    }),

    updateTeam: Effect.fn("AdminOrganizationsService.updateTeam")(function* (
      input: InferInput<"adminUpdateTeam">,
    ) {
      const team = yield* attemptDb(() =>
        db.query.team.findFirst({ where: eq(schema.team.id, input.teamId) }),
      );
      if (!team) {
        return yield* new TeamNotFound({ message: "Team not found", teamId: input.teamId });
      }

      const [updated] = yield* attemptDb(() =>
        db
          .update(schema.team)
          .set({
            ...(input.data.name !== undefined ? { name: input.data.name } : {}),
            ...(input.data.metadata !== undefined
              ? { metadata: JSON.stringify(input.data.metadata) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.team.id, input.teamId))
          .returning(),
      );
      if (!updated) {
        return yield* new TeamNotFound({ message: "Team not found", teamId: input.teamId });
      }
      return toTeam(updated);
    }),

    deleteTeam: Effect.fn("AdminOrganizationsService.deleteTeam")(function* (teamId: string) {
      const team = yield* attemptDb(() =>
        db.query.team.findFirst({ where: eq(schema.team.id, teamId) }),
      );
      if (!team) {
        return yield* new TeamNotFound({ message: "Team not found", teamId });
      }

      yield* attemptDb(() =>
        db
          .update(schema.session)
          .set({ activeTeamId: null })
          .where(eq(schema.session.activeTeamId, teamId)),
      );
      yield* attemptDb(() => db.delete(schema.team).where(eq(schema.team.id, teamId)));
      return { success: true };
    }),

    addTeamMember: Effect.fn("AdminOrganizationsService.addTeamMember")(function* (
      input: InferInput<"adminAddTeamMember">,
    ) {
      const role = input.role ?? "member";
      if (!(role in registry.roleGrants)) {
        return yield* new UnknownTeamRole({
          message: `Unknown team role "${role}" — declare it in siwn.permissions.roles (valid: ${Object.keys(registry.roleGrants).join(", ")})`,
        });
      }

      const team = yield* attemptDb(() =>
        db.query.team.findFirst({ where: eq(schema.team.id, input.teamId) }),
      );
      if (!team) {
        return yield* new TeamNotFound({ message: "Team not found", teamId: input.teamId });
      }

      const user = yield* attemptDb(() =>
        db.query.user.findFirst({ where: eq(schema.user.id, input.userId) }),
      );
      if (!user) {
        return yield* new UserNotFound({
          message: `User not found: ${input.userId}`,
          userId: input.userId,
        });
      }

      const membership = yield* attemptDb(() =>
        db.query.member.findFirst({
          where: and(
            eq(schema.member.organizationId, team.organizationId),
            eq(schema.member.userId, input.userId),
          ),
        }),
      );
      if (!membership) {
        return yield* new AuthApiError({
          code: "BAD_REQUEST",
          data: {},
          message: "User is not a member of the team's organization",
        });
      }

      const existing = yield* attemptDb(() =>
        db.query.teamMember.findFirst({
          where: and(
            eq(schema.teamMember.teamId, team.id),
            eq(schema.teamMember.userId, input.userId),
          ),
        }),
      );
      if (existing) {
        return yield* new AuthApiError({
          code: "BAD_REQUEST",
          data: {},
          message: "User is already a member of this team",
        });
      }

      const now = new Date();
      const [teamMember] = yield* attemptDb(() =>
        db
          .insert(schema.teamMember)
          .values({
            id: crypto.randomUUID(),
            teamId: team.id,
            userId: input.userId,
            role,
            createdAt: now,
          })
          .returning(),
      );
      if (!teamMember) {
        return yield* new TeamUpdateFailed({ message: "Team member creation failed" });
      }
      yield* syncTeamMemberCount(team.id);
      return {
        id: teamMember.id,
        teamId: teamMember.teamId,
        userId: teamMember.userId,
        role: teamMember.role,
        createdAt: toDate(teamMember.createdAt),
      };
    }),

    removeTeamMember: Effect.fn("AdminOrganizationsService.removeTeamMember")(function* (
      input: InferInput<"adminRemoveTeamMember">,
    ) {
      const team = yield* attemptDb(() =>
        db.query.team.findFirst({ where: eq(schema.team.id, input.teamId) }),
      );
      if (!team) {
        return yield* new TeamNotFound({ message: "Team not found", teamId: input.teamId });
      }

      const teamMember = yield* attemptDb(() =>
        db.query.teamMember.findFirst({
          where: and(
            eq(schema.teamMember.teamId, team.id),
            eq(schema.teamMember.userId, input.userId),
          ),
        }),
      );
      if (!teamMember) {
        return yield* new TeamMemberNotFound({
          message: "Team member not found",
          teamMemberId: `${input.teamId}:${input.userId}`,
        });
      }

      yield* attemptDb(() =>
        db.delete(schema.teamMember).where(eq(schema.teamMember.id, teamMember.id)),
      );
      yield* syncTeamMemberCount(team.id);
      return { success: true };
    }),
  });
};

export type AdminOrganizationsServiceShape = ReturnType<typeof buildAdminOrganizationsService>;
