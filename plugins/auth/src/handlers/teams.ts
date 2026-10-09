import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "../db/schema";
import { AuthServicesTag } from "../service-types";
import {
  createHeaders,
  getActiveOrganizationId,
  parseTeamAreas,
  serializeTeamAreas,
  withoutSessionDataCookie,
} from "../utils";
import { attemptAuth, attemptDb } from "./attempts";

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return value ? new Date(value as string) : new Date();
}

function toTeam(team: any) {
  return {
    id: team.id,
    name: team.name,
    organizationId: team.organizationId,
    areas: parseTeamAreas(team.metadata),
    createdAt: toDate(team.createdAt),
    updatedAt: toDate(team.updatedAt),
  };
}

export function createTeamHandlers(builder: any, requireAuth: any) {
  return {
    setActiveTeam: builder.setActiveTeam.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.setActiveTeam({
          headers: createHeaders(context.reqHeaders),
          body: { teamId: input.teamId },
        }),
      );
      return result ? toTeam(result) : null;
    }),

    listUserTeams: builder.listUserTeams.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const headers = createHeaders(context.reqHeaders);
      const organizationId =
        input?.organizationId ??
        getActiveOrganizationId(
          (yield* attemptAuth(() => services.auth.api.getSession({ headers })))?.session,
        );
      const result = yield* attemptAuth(() => services.auth.api.listUserTeams({ headers }));
      return (result ?? [])
        .filter((team: any) => !organizationId || team.organizationId === organizationId)
        .map(toTeam);
    }),

    createTeam: builder.createTeam.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.createTeam({
          headers: createHeaders(context.reqHeaders),
          body: {
            name: input.name,
            organizationId: input.organizationId,
            ...(input.areas ? { metadata: serializeTeamAreas(input.areas) } : {}),
          },
        }),
      );
      return toTeam(result);
    }),

    updateTeam: builder.updateTeam.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.updateTeam({
          headers: createHeaders(context.reqHeaders),
          body: {
            teamId: input.teamId,
            data: {
              ...(input.organizationId ? { organizationId: input.organizationId } : {}),
              ...(input.data.name !== undefined ? { name: input.data.name } : {}),
              ...(input.data.areas ? { metadata: serializeTeamAreas(input.data.areas) } : {}),
            },
          },
        }),
      );
      if (!result) {
        return yield* Effect.fail(
          new ORPCError("INTERNAL_SERVER_ERROR", { message: "Team not found" }),
        );
      }
      return toTeam(result);
    }),

    deleteTeam: builder.deleteTeam.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const headers = createHeaders(context.reqHeaders);
      // Clear directly in the database rather than through
      // auth.api.setActiveTeam: that call would only echo back whatever
      // session the request's session_data cookie already carries (see
      // below), not the DB row this write targets.
      yield* attemptDb(() =>
        services.db
          .update(schema.session)
          .set({ activeTeamId: null })
          .where(
            and(
              eq(schema.session.userId, context.userId),
              eq(schema.session.activeTeamId, input.teamId),
            ),
          ),
      );
      // removeTeam's own FORBIDDEN-on-own-active-team guard resolves the
      // session from the request's better-auth.session_data cookie, a
      // short-lived cache of the session as of its last refresh — not the
      // database row just cleared above. Strip it so removeTeam falls
      // back to a fresh database read via the session token instead.
      yield* attemptAuth(() =>
        services.auth.api.removeTeam({
          headers: withoutSessionDataCookie(headers),
          body: {
            teamId: input.teamId,
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),

    listTeams: builder.listTeams.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.listOrganizationTeams({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
          },
        }),
      );
      return (result ?? []).map(toTeam);
    }),

    listTeamMembers: builder.listTeamMembers.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const team = yield* attemptDb(() =>
        services.db.query.team.findFirst({
          where: eq(schema.team.id, input.teamId),
        }),
      );
      if (!team) {
        return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Team not found" }));
      }
      const membership = yield* attemptDb(() =>
        services.db.query.member.findFirst({
          where: and(
            eq(schema.member.userId, context.userId),
            eq(schema.member.organizationId, team.organizationId),
          ),
        }),
      );
      if (!membership) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "You are not a member of this team's organization",
          }),
        );
      }
      const rows = yield* attemptDb(() =>
        services.db.query.teamMember.findMany({
          where: eq(schema.teamMember.teamId, team.id),
        }),
      );
      return rows.map((tm) => ({
        id: tm.id,
        teamId: tm.teamId,
        userId: tm.userId,
        createdAt: toDate(tm.createdAt),
      }));
    }),

    addTeamMember: builder.addTeamMember.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      const result = yield* attemptAuth(() =>
        services.auth.api.addTeamMember({
          headers: createHeaders(context.reqHeaders),
          body: {
            teamId: input.teamId,
            userId: input.userId,
            organizationId: input.organizationId,
          },
        }),
      );
      return {
        id: result.id,
        teamId: result.teamId,
        userId: result.userId,
        createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
      };
    }),

    removeTeamMember: builder.removeTeamMember.use(requireAuth).effect(function* ({
      input,
      context,
    }: {
      input: any;
      context: any;
    }) {
      const services = yield* AuthServicesTag;
      yield* attemptAuth(() =>
        services.auth.api.removeTeamMember({
          headers: createHeaders(context.reqHeaders),
          body: {
            teamId: input.teamId,
            userId: input.userId,
            organizationId: input.organizationId,
          },
        }),
      );
      return { success: true };
    }),
  };
}
