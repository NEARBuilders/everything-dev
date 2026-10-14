import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { memberSchema, memberWithUserSchema } from "./schemas";

export const memberRoutes = {
  getActiveMember: oc
    .route({ method: "GET", path: "/v1/auth/active-member" })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(
      z.object({
        id: z.string().nullable(),
        role: z.string().nullable(),
        organizationId: z.string().nullable(),
      }),
    )
    .errors(Errors),

  getActiveMemberRole: oc
    .route({ method: "GET", path: "/v1/auth/members/active-role" })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ role: z.string().nullable() }))
    .errors(Errors),

  listMembers: oc
    .route({ method: "GET", path: "/v1/auth/members" })
    .input(
      z.object({
        organizationId: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }),
    )
    .output(z.object({ members: z.array(memberWithUserSchema), total: z.number() }))
    .errors(Errors),

  exportMembers: oc
    .route({
      method: "GET",
      path: "/v1/auth/members/export",
      summary: "Export organization members as CSV",
      description:
        "Requires the org email:read permission (granted to owner/admin roles). " +
        "Returns name,email,role rows including member email addresses.",
    })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ csv: z.string() }))
    .errors(Errors),

  addMember: oc
    .route({ method: "POST", path: "/v1/auth/members" })
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["owner", "admin", "member"]),
        organizationId: z.string().optional(),
      }),
    )
    .output(memberSchema)
    .errors(Errors),

  removeMember: oc
    .route({ method: "POST", path: "/v1/auth/members/remove" })
    .input(
      z.object({
        memberIdOrEmail: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  updateMemberRole: oc
    .route({ method: "POST", path: "/v1/auth/members/update-role" })
    .input(
      z.object({
        role: z.enum(["owner", "admin", "member"]),
        memberId: z.string(),
        organizationId: z.string().optional(),
      }),
    )
    .output(memberWithUserSchema)
    .errors(Errors),
};
