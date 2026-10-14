import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { teamMemberSchema, teamSchema } from "./schemas";

export const teamRoutes = {
  createTeam: oc
    .route({ method: "POST", path: "/v1/auth/teams" })
    .input(
      z.object({
        name: z.string(),
        organizationId: z.string().optional(),
        areas: z.array(z.string()).optional(),
      }),
    )
    .output(teamSchema)
    .errors(Errors),

  updateTeam: oc
    .route({ method: "POST", path: "/v1/auth/teams/update" })
    .input(
      z.object({
        teamId: z.string(),
        organizationId: z.string().optional(),
        data: z.object({
          name: z.string().optional(),
          areas: z.array(z.string()).optional(),
        }),
      }),
    )
    .output(teamSchema)
    .errors(Errors),

  deleteTeam: oc
    .route({ method: "POST", path: "/v1/auth/teams/delete" })
    .input(
      z.object({
        teamId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  listTeams: oc
    .route({ method: "GET", path: "/v1/auth/teams" })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(z.array(teamSchema))
    .errors(Errors),

  setActiveTeam: oc
    .route({ method: "POST", path: "/v1/auth/teams/set-active" })
    .input(z.object({ teamId: z.string().nullable() }))
    .output(teamSchema.nullable())
    .errors(Errors),

  listUserTeams: oc
    .route({ method: "GET", path: "/v1/auth/teams/user" })
    .input(z.object({ organizationId: z.string().optional() }).optional())
    .output(z.array(teamSchema))
    .errors(Errors),

  listTeamMembers: oc
    .route({ method: "GET", path: "/v1/auth/teams/members" })
    .input(z.object({ teamId: z.string() }))
    .output(z.array(teamMemberSchema))
    .errors(Errors),

  addTeamMember: oc
    .route({ method: "POST", path: "/v1/auth/teams/members" })
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(teamMemberSchema)
    .errors(Errors),

  removeTeamMember: oc
    .route({ method: "POST", path: "/v1/auth/teams/members/remove" })
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),
};
