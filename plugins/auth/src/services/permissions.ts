import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { AuthApiTag, type PluginServices } from "../service-types";
import { createHeaders, getActiveOrganizationId, parseTeamAreas } from "../utils";
import {
  type AuthFailure,
  NoOrganizationSelected,
  NotOrganizer,
  OrgRequiresApproval,
} from "./domain-errors";

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
    ) => Effect.Effect<{ userId: string; organizationId: string; headers: Headers }, AuthFailure>;
  }
>()("auth/PermissionsService") {}

export const buildPermissionsService = ({ auth, db }: { auth: Auth; db: Db }) =>
  PermissionsService.of({
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
          new NoOrganizationSelected({ message: "No organization selected" }),
        );
      }
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (organization?.status !== "active") {
        return yield* Effect.fail(
          new OrgRequiresApproval({ message: "Organization requires platform-admin approval" }),
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
          new NotOrganizer({
            message:
              "Only organizers — organization owners, admins, or members of a team with the events area — can manage onboarding codes",
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
    return buildPermissionsService({ auth, db });
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
