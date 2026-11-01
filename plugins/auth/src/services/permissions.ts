import { and, eq } from "drizzle-orm";
import { Context, Effect } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import * as schema from "../db/schema";
import type { PluginServices } from "../service-types";
import { createHeaders, memberRoleOf, parseTeamAreas } from "../utils";
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
  sessionId?: string | null;
  activeOrganizationId?: string | null;
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
      const organizationId = inputOrganizationId ?? context.activeOrganizationId ?? null;
      const userId = context.userId;
      if (!userId || !organizationId) {
        return yield* new NoOrganizationSelected({ message: "No organization selected" });
      }
      const headers = createHeaders(context.reqHeaders);
      const organization = yield* attemptDb(() =>
        db.query.organization.findFirst({
          where: eq(schema.organization.id, organizationId),
        }),
      );
      if (organization?.status !== "active") {
        return yield* new OrgRequiresApproval({
          message: "Organization requires platform-admin approval",
        });
      }
      const result = yield* attemptAuth(() =>
        auth.api.getActiveMemberRole({
          headers,
          query: { organizationId },
        }),
      );
      const role = memberRoleOf(result);
      const isOrganizer =
        role === "owner" ||
        role === "admin" ||
        (role !== null &&
          (yield* Effect.promise(() => belongsToEventsTeam(db, userId, organizationId))));
      if (!isOrganizer) {
        return yield* new NotOrganizer({
          message:
            "Only organizers — organization owners, admins, or members of a team with the events area — can manage onboarding codes",
        });
      }
      return { userId, organizationId, headers };
    }),
  });

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
