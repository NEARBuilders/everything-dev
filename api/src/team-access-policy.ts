import type { DecoratedMiddleware } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { type FeatureArea, isFeatureArea } from "./feature-areas";
import type {
  AuthPluginContext as AuthContext,
  AuthOrganizationContext,
} from "./lib/auth-types.gen";

type IsAny<T> = 0 extends 1 & T ? true : false;

type OrganizationContext = NonNullable<AuthOrganizationContext>;

type GeneratedTeam = OrganizationContext extends { teams: ReadonlyArray<infer Team> }
  ? Team
  : never;

type FallbackTeam = { id: string; name: string; areas: string[] };

export type WorkspaceTeam =
  IsAny<GeneratedTeam> extends true
    ? FallbackTeam
    : GeneratedTeam extends FallbackTeam
      ? GeneratedTeam
      : FallbackTeam;

export interface TeamAccess {
  teams: WorkspaceTeam[];
  activeTeam: WorkspaceTeam | null;
  bypass: boolean;
  allowedAreas: FeatureArea[] | null;
}

type TeamAccessContext = {
  user?: { role?: string | null } | null;
  organization?: {
    member?: { role?: string | null } | null;
    teams?: readonly WorkspaceTeam[];
    activeTeamId?: string | null;
  } | null;
} | null;

export function resolveTeamAccess(context: TeamAccessContext | undefined): TeamAccess {
  const teams = [...(context?.organization?.teams ?? [])];
  const activeTeam = teams.find((team) => team.id === context?.organization?.activeTeamId) ?? null;
  const orgRole = context?.organization?.member?.role;
  const bypass = context?.user?.role === "admin" || orgRole === "owner" || orgRole === "admin";
  return {
    teams,
    activeTeam,
    bypass,
    allowedAreas: activeTeam && !bypass ? activeTeam.areas.filter(isFeatureArea) : null,
  };
}

/**
 * Gates a route on the caller's active team having one of the given areas.
 * Assumes `requireAuth` already ran on the route — it only adds the
 * team-specific check on top, rather than re-deriving auth from scratch.
 */
export function createRequireTeamArea(builder: any) {
  type TeamAreaMiddleware = DecoratedMiddleware<
    AuthContext,
    { activeTeam: WorkspaceTeam | null },
    any,
    any,
    any
  >;

  return <TAreas extends readonly FeatureArea[]>(...areas: TAreas) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
      const { activeTeam, allowedAreas } = resolveTeamAccess(context);
      if (
        activeTeam &&
        allowedAreas !== null &&
        !areas.some((area) => allowedAreas.includes(area))
      ) {
        throw new ORPCError("FORBIDDEN", {
          message: `Your active team "${activeTeam.name}" is not granted ${areas.join(" or ")}. Switch teams or ask an organization owner to grant it.`,
          data: { requiredPermissions: [...areas], action: "switch-team" },
        });
      }
      return next({ context: { activeTeam } });
    }) as TeamAreaMiddleware;
}
