import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import {
  daoOutputSchema,
  invitationSchema,
  memberSchema,
  organizationInfoSchema,
  teamSchema,
} from "./schemas";

export const organizationRoutes = {
  listOrganizations: oc
    .route({ method: "GET", path: "/v1/auth/organizations" })
    .output(z.array(organizationInfoSchema.extend({ createdAt: z.date() })))
    .errors(Errors),

  getFullOrganization: oc
    .route({ method: "GET", path: "/v1/auth/organizations/get-full" })
    .input(
      z.object({
        organizationId: z.string().optional(),
        organizationSlug: z.string().optional(),
        membersLimit: z.number().optional(),
      }),
    )
    .output(
      organizationInfoSchema
        .extend({
          createdAt: z.date(),
          members: z.array(memberSchema),
          invitations: z.array(invitationSchema),
          teams: z.array(teamSchema).optional(),
        })
        .nullable(),
    )
    .errors(Errors),

  getOrganizationForAdmin: oc
    .route({ method: "GET", path: "/v1/auth/admin/organizations/{organizationId}" })
    .input(z.object({ organizationId: z.string() }))
    .output(organizationInfoSchema.nullable())
    .errors(Errors),

  createOrganization: oc
    .route({ method: "POST", path: "/v1/auth/organizations" })
    .input(
      z.object({
        name: z.string(),
        slug: z.string(),
        logo: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .output(organizationInfoSchema.extend({ createdAt: z.date() }))
    .errors(Errors),

  setActiveOrganization: oc
    .route({ method: "POST", path: "/v1/auth/organizations/set-active" })
    .input(z.object({ organizationId: z.string().nullable() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  updateOrganization: oc
    .route({ method: "POST", path: "/v1/auth/organizations/update" })
    .input(
      z.object({
        data: z.object({
          name: z.string().optional(),
          slug: z.string().optional(),
          logo: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
        organizationId: z.string().optional(),
      }),
    )
    .output(organizationInfoSchema)
    .errors(Errors),

  leaveOrganization: oc
    .route({ method: "POST", path: "/v1/auth/organizations/leave" })
    .input(z.object({ organizationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  deleteOrganization: oc
    .route({ method: "POST", path: "/v1/auth/organizations/delete" })
    .input(z.object({ organizationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  checkSlug: oc
    .route({ method: "POST", path: "/v1/auth/organizations/check-slug" })
    .input(z.object({ slug: z.string() }))
    .output(z.object({ status: z.boolean() }))
    .errors(Errors),

  hasPermission: oc
    .route({ method: "POST", path: "/v1/auth/organizations/has-permission" })
    .input(
      z.object({
        organizationId: z.string().optional(),
        permissions: z.record(z.string(), z.array(z.string())).optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  linkDao: oc
    .route({ method: "POST", path: "/v1/auth/organizations/dao/link" })
    .input(
      z.object({
        organizationId: z.string(),
        daoAccountId: z.string(),
        daoNetwork: z.enum(["mainnet", "testnet"]).optional(),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  unlinkDao: oc
    .route({ method: "POST", path: "/v1/auth/organizations/dao/unlink" })
    .input(z.object({ organizationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  getDao: oc
    .route({ method: "GET", path: "/v1/auth/organizations/dao" })
    .input(z.object({ organizationId: z.string() }))
    .output(daoOutputSchema)
    .errors(Errors),
};
