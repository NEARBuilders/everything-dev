import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { toDate, toTeam } from "../serializers";
import {
  AuthApiTag,
  type PermissionRegistry,
  PermissionRegistryTag,
  type PluginServices,
} from "../service-types";
import { getActiveOrganizationId, serializeTeamAreas, withoutSessionDataCookie } from "../utils";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

export class TeamsService extends Context.Service<
  TeamsService,
  {
    setActiveTeam: (
      headers: Headers,
      teamId: string | null,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    listUserTeams: (
      headers: Headers,
      organizationId: string | undefined,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    createTeam: (
      headers: Headers,
      input: {
        name: string;
        organizationId?: string;
        areas?: string[];
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    updateTeam: (
      headers: Headers,
      input: {
        teamId: string;
        organizationId?: string;
        data: { name?: string; areas?: string[] };
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    deleteTeam: (
      headers: Headers,
      userId: string,
      input: { teamId: string; organizationId?: string },
    ) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
    listTeams: (
      headers: Headers,
      organizationId: string | undefined,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    listTeamMembers: (
      userId: string,
      teamId: string,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    addTeamMember: (
      headers: Headers,
      input: { teamId: string; userId: string; organizationId?: string; role?: string },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    removeTeamMember: (
      headers: Headers,
      input: { teamId: string; userId: string; organizationId?: string },
    ) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
  }
>()("auth/TeamsService") {}

export const buildTeamsService = ({
  auth,
  db,
  registry,
}: {
  auth: Auth;
  db: Db;
  registry: PermissionRegistry;
}) =>
  TeamsService.of({
    setActiveTeam: (headers, teamId) =>
      attemptAuth(() => auth.api.setActiveTeam({ headers, body: { teamId } })).pipe(
        Effect.map((result) => (result ? toTeam(result) : null)),
      ),

    listUserTeams: Effect.fn("TeamsService.listUserTeams")(function* (
      headers: Headers,
      organizationId: string | undefined,
    ) {
      const resolved =
        organizationId ??
        getActiveOrganizationId(
          (yield* attemptAuth(() => auth.api.getSession({ headers })))?.session,
        );
      const result = yield* attemptAuth(() => auth.api.listUserTeams({ headers }));
      return (result ?? [])
        .filter((team: any) => !resolved || team.organizationId === resolved)
        .map(toTeam);
    }),

    createTeam: (headers, input) =>
      attemptAuth(() =>
        auth.api.createTeam({
          headers,
          body: {
            name: input.name,
            organizationId: input.organizationId,
            ...(input.areas ? { metadata: serializeTeamAreas(input.areas) } : {}),
          },
        }),
      ).pipe(Effect.map(toTeam)),

    updateTeam: (headers, input) =>
      attemptAuth(() =>
        auth.api.updateTeam({
          headers,
          body: {
            teamId: input.teamId,
            data: {
              ...(input.organizationId ? { organizationId: input.organizationId } : {}),
              ...(input.data.name !== undefined ? { name: input.data.name } : {}),
              ...(input.data.areas ? { metadata: serializeTeamAreas(input.data.areas) } : {}),
            },
          },
        }),
      ).pipe(
        Effect.flatMap((result) =>
          result
            ? Effect.succeed(toTeam(result))
            : Effect.fail(new ORPCError("INTERNAL_SERVER_ERROR", { message: "Team not found" })),
        ),
      ),

    deleteTeam: Effect.fn("TeamsService.deleteTeam")(function* (
      headers: Headers,
      userId: string,
      input: { teamId: string; organizationId?: string },
    ) {
      yield* attemptDb(() =>
        db
          .update(schema.session)
          .set({ activeTeamId: null })
          .where(
            and(eq(schema.session.userId, userId), eq(schema.session.activeTeamId, input.teamId)),
          ),
      );
      yield* attemptAuth(() =>
        auth.api.removeTeam({
          headers: withoutSessionDataCookie(headers),
          body: {
            teamId: input.teamId,
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),

    listTeams: (headers, organizationId) =>
      attemptAuth(() =>
        auth.api.listOrganizationTeams({
          headers,
          query: { organizationId },
        }),
      ).pipe(Effect.map((result) => (result ?? []).map(toTeam))),

    listTeamMembers: Effect.fn("TeamsService.listTeamMembers")(function* (
      userId: string,
      teamId: string,
    ) {
      const team = yield* attemptDb(() =>
        db.query.team.findFirst({
          where: eq(schema.team.id, teamId),
        }),
      );
      if (!team) {
        return yield* Effect.fail(
          new ORPCError("NOT_FOUND", {
            message: "Team not found",
            data: { resource: "team", resourceId: teamId },
          }),
        );
      }
      const membership = yield* attemptDb(() =>
        db.query.member.findFirst({
          where: and(
            eq(schema.member.userId, userId),
            eq(schema.member.organizationId, team.organizationId),
          ),
        }),
      );
      if (!membership) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "You are not a member of this team's organization",
            data: {},
          }),
        );
      }
      const rows = yield* attemptDb(() =>
        db.query.teamMember.findMany({
          where: eq(schema.teamMember.teamId, team.id),
        }),
      );
      return rows.map((tm) => ({
        id: tm.id,
        teamId: tm.teamId,
        userId: tm.userId,
        role: tm.role,
        createdAt: toDate(tm.createdAt),
      }));
    }),

    addTeamMember: Effect.fn("TeamsService.addTeamMember")(function* (
      headers: Headers,
      input: { teamId: string; userId: string; organizationId?: string; role?: string },
    ) {
      if (input.role !== undefined && !(input.role in registry.roleGrants)) {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", {
            message: `Unknown team role "${input.role}" — declare it in siwn.permissions.roles (valid: ${Object.keys(registry.roleGrants).join(", ")})`,
            data: {},
          }),
        );
      }
      const result = yield* attemptAuth(() =>
        auth.api.addTeamMember({
          headers,
          body: {
            teamId: input.teamId,
            userId: input.userId,
            organizationId: input.organizationId,
          },
        }),
      );
      if (input.role !== undefined && input.role !== "member") {
        yield* attemptDb(() =>
          db
            .update(schema.teamMember)
            .set({ role: input.role })
            .where(
              and(
                eq(schema.teamMember.teamId, input.teamId),
                eq(schema.teamMember.userId, input.userId),
              ),
            ),
        );
      }
      return {
        id: result.id,
        teamId: result.teamId,
        userId: result.userId,
        role: input.role ?? "member",
        createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
      };
    }),

    removeTeamMember: (headers, input) =>
      attemptAuth(() =>
        auth.api.removeTeamMember({
          headers,
          body: {
            teamId: input.teamId,
            userId: input.userId,
            organizationId: input.organizationId,
          },
        }),
      ).pipe(Effect.as({ success: true })),
  });

export const TeamsServiceLive = Layer.effect(
  TeamsService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    const registry = yield* PermissionRegistryTag;
    return buildTeamsService({ auth, db, registry });
  }),
);
