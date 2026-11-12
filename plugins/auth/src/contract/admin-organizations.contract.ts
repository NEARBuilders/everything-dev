import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import {
  adminOrganizationSummarySchema,
  invitationSchema,
  memberSchema,
  memberWithUserSchema,
  organizationInfoSchema,
  teamMemberSchema,
  teamSchema,
} from "./schemas";

export const adminOrganizationRoutes = {
  adminListOrganizations: oc
    .route({
      method: "GET",
      path: "/v1/auth/admin/organizations",
      summary: "List all organizations",
      description:
        "Requires the platform admin role. Search by name, slug, or id substring and filter " +
        "by status and the personal-organization metadata flag, paginated server-side.",
    })
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.enum(["active", "pending", "rejected"]).optional(),
          personal: z.boolean().optional(),
          limit: z.number().int().positive().max(100).optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .output(
      z.object({
        organizations: z.array(adminOrganizationSummarySchema),
        total: z.number(),
      }),
    )
    .errors(Errors),

  adminGetOrganizationFull: oc
    .route({
      method: "GET",
      path: "/v1/auth/admin/organizations/{organizationId}/full",
      summary: "Get the full organization detail",
      description:
        "Requires the platform admin role. Returns the organization with its members " +
        "(including user info), invitations, and teams.",
    })
    .input(z.object({ organizationId: z.string() }))
    .output(
      organizationInfoSchema.extend({
        createdAt: z.date(),
        members: z.array(memberWithUserSchema),
        invitations: z.array(invitationSchema),
        teams: z.array(teamSchema),
      }),
    )
    .errors(Errors),

  adminCreateOrganizationForUser: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/create-for-user",
      summary: "Create an organization on behalf of a user",
      description:
        "Requires the platform admin role. Creates the organization and an owner member row " +
        "for the given user. The slug is derived from the name when omitted.",
    })
    .input(
      z.object({
        userId: z.string(),
        name: z.string(),
        slug: z.string().optional(),
        logo: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(organizationInfoSchema.extend({ createdAt: z.date() }))
    .errors(Errors),

  adminUpdateOrganization: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/update",
      summary: "Update any organization",
      description:
        "Requires the platform admin role. Updates name, slug, logo, status, or metadata " +
        "without requiring membership in the organization.",
    })
    .input(
      z.object({
        organizationId: z.string(),
        data: z.object({
          name: z.string().optional(),
          slug: z.string().optional(),
          logo: z.string().nullable().optional(),
          status: z.enum(["active", "pending", "rejected"]).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .output(organizationInfoSchema)
    .errors(Errors),

  adminDeleteOrganization: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/delete",
      summary: "Delete any organization",
      description:
        "Requires the platform admin role. Deletes the organization, its members, teams, and " +
        "invitations. Downstream attribution cleanup is the consumer's responsibility.",
    })
    .input(z.object({ organizationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  adminAddMember: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/members",
      summary: "Add a member to any organization",
      description:
        "Requires the platform admin role. Enforces the organization membership limit policy.",
    })
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
        role: z.enum(["owner", "admin", "member"]),
      }),
    )
    .output(memberSchema)
    .errors(Errors),

  adminRemoveMember: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/members/remove",
      summary: "Remove a member from any organization",
      description:
        "Requires the platform admin role. Refuses to remove an organization's only owner.",
    })
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  adminUpdateMemberRole: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/members/update-role",
      summary: "Update a member's role in any organization",
      description: "Requires the platform admin role.",
    })
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
        role: z.enum(["owner", "admin", "member"]),
      }),
    )
    .output(memberSchema)
    .errors(Errors),

  adminCreateTeam: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/teams",
      summary: "Create a team in any organization",
      description: "Requires the platform admin role.",
    })
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        eventId: z.string().optional(),
      }),
    )
    .output(teamSchema)
    .errors(Errors),

  adminUpdateTeam: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/teams/update",
      summary: "Update a team",
      description: "Requires the platform admin role.",
    })
    .input(
      z.object({
        teamId: z.string(),
        data: z.object({
          name: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .output(teamSchema)
    .errors(Errors),

  adminDeleteTeam: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/teams/delete",
      summary: "Delete a team",
      description: "Requires the platform admin role.",
    })
    .input(z.object({ teamId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  adminAddTeamMember: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/teams/members",
      summary: "Add a member to a team",
      description:
        "Requires the platform admin role. The user must already be a member of the " +
        "team's organization. Team roles must be declared in siwn.permissions.roles.",
    })
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.string().optional(),
      }),
    )
    .output(teamMemberSchema)
    .errors(Errors),

  adminRemoveTeamMember: oc
    .route({
      method: "POST",
      path: "/v1/auth/admin/organizations/teams/members/remove",
      summary: "Remove a member from a team",
      description: "Requires the platform admin role.",
    })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),
};
