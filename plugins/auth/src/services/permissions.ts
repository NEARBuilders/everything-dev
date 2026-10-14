import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import {
  AuthApiTag,
  type PermissionRegistry,
  PermissionRegistryTag,
  type PluginServices,
} from "../service-types";
import { createHeaders, getActiveOrganizationId, parseTeamAreas } from "../utils";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];
type SessionUser = PluginServices["auth"]["$Infer"]["Session"]["user"];

export interface OrganizerCaller {
  reqHeaders?: Record<string, string>;
  userId: string;
  user: SessionUser;
}

export class PermissionsService extends Context.Service<
  PermissionsService,
  {
    requireOrganizer: (
      context: OrganizerCaller,
      inputOrganizationId: string | undefined,
    ) => Effect.Effect<
      { userId: string; organizationId: string; headers: Headers },
      ORPCError<string, unknown>
    >;
    hasTeamPermission: (
      context: { userId: string },
      organizationId: string,
      required: Record<string, string[]>,
    ) => Effect.Effect<boolean, ORPCError<string, unknown>>;
  }
>()("auth/PermissionsService") {}

export const buildPermissionsService = ({
  auth,
  db,
  registry,
}: {
  auth: Auth;
  db: Db;
  registry: PermissionRegistry;
}) =>
  PermissionsService.of({
    hasTeamPermission: Effect.fn("PermissionsService.hasTeamPermission")(function* (
      context: { userId: string },
      organizationId: string,
      required: Record<string, string[]>,
    ) {
      const orgMember = yield* attemptDb(() =>
        db.query.member.findFirst({
          where: and(
            eq(schema.member.userId, context.userId),
            eq(schema.member.organizationId, organizationId),
          ),
        }),
      );
      const teamRoles = yield* attemptDb(() =>
        db
          .select({ role: schema.teamMember.role })
          .from(schema.teamMember)
          .innerJoin(schema.team, eq(schema.teamMember.teamId, schema.team.id))
          .where(
            and(
              eq(schema.teamMember.userId, context.userId),
              eq(schema.team.organizationId, organizationId),
            ),
          ),
      );
      const union: Record<string, Set<string>> = {};
      for (const role of [orgMember?.role, ...teamRoles.map((row) => row.role)]) {
        for (const [statement, actions] of Object.entries(registry.roleGrants[role ?? ""] ?? {})) {
          const bucket = union[statement] ?? new Set<string>();
          for (const action of actions) bucket.add(action);
          union[statement] = bucket;
        }
      }
      for (const [statement, actions] of Object.entries(required)) {
        const granted = union[statement];
        for (const action of actions) {
          if (!granted?.has(action)) return false;
        }
      }
      return true;
    }),

    requireOrganizer: Effect.fn("PermissionsService.requireOrganizer")(function* (
      context: OrganizerCaller,
      inputOrganizationId: string | undefined,
    ) {
      const headers = createHeaders(context.reqHeaders);
      const session = yield* attemptAuth(() => auth.api.getSession({ headers }));
      const sessionData = session as {
        user?: { id?: string };
        session?: { activeOrganizationId?: string | null };
      } | null;
      const userId = context.userId ?? sessionData?.user?.id ?? null;
      const organizationId =
        inputOrganizationId ?? getActiveOrganizationId(sessionData?.session) ?? null;
      if (!userId || !organizationId) {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", { message: "No organization selected", data: {} }),
        );
      }
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (organization?.status !== "active") {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "Organization requires platform-admin approval",
            data: {},
          }),
        );
      }
      const result = yield* attemptAuth(() =>
        auth.api.getActiveMemberRole({
          headers,
          query: { organizationId },
        }),
      );
      const role = typeof result === "string" ? result : ((result as any)?.role ?? null);
      const isOrganizer =
        role === "owner" ||
        role === "admin" ||
        (role !== null &&
          (yield* Effect.promise(() => belongsToEventsTeam(db, userId, organizationId))));
      if (!isOrganizer) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message:
              "Only organizers — organization owners, admins, or members of a team with the events area — can manage onboarding codes",
            data: { action: "manage-onboarding" },
          }),
        );
      }
      return { userId, organizationId, headers };
    }),
  });

export const PermissionsServiceLive = Layer.effect(
  PermissionsService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    const registry = yield* PermissionRegistryTag;
    return buildPermissionsService({ auth, db, registry });
  }),
);

async function belongsToEventsTeam(
  db: Db,
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
  return teams.some((team) => parseTeamAreas(team.metadata).includes("events"));
}
