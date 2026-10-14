import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { invitationSchema } from "./schemas";

export const invitationRoutes = {
  inviteMember: oc
    .route({ method: "POST", path: "/v1/auth/invitations" })
    .input(
      z.object({
        email: z.string().optional(),
        nearAccountId: z.string().optional(),
        nearNetwork: z.enum(["mainnet", "testnet"]).optional(),
        role: z.enum(["owner", "admin", "member"]),
        organizationId: z.string().optional(),
        teamId: z.string().optional(),
        resend: z.boolean().optional(),
      }),
    )
    .output(invitationSchema)
    .errors(Errors),

  getInvitation: oc
    .route({ method: "GET", path: "/v1/auth/invitations/get" })
    .input(z.object({ id: z.string() }))
    .output(
      z
        .object({
          id: z.string(),
          organizationId: z.string(),
          email: z.string().nullable(),
          role: z.string().nullable(),
          status: z.string(),
          expiresAt: z.date(),
          inviterId: z.string(),
          teamId: z.string().nullable(),
          nearAccountId: z.string().nullable(),
          nearNetwork: z.enum(["mainnet", "testnet"]).nullable(),
          organizationName: z.string(),
          organizationSlug: z.string(),
          inviterName: z.string().nullable(),
        })
        .nullable(),
    )
    .errors(Errors),

  listInvitations: oc
    .route({ method: "GET", path: "/v1/auth/invitations" })
    .input(
      z.object({
        organizationId: z.string().optional(),
      }),
    )
    .output(z.array(invitationSchema))
    .errors(Errors),

  listUserInvitations: oc
    .route({ method: "GET", path: "/v1/auth/invitations/user" })
    .output(
      z.array(
        invitationSchema.extend({
          organizationName: z.string().optional(),
          organizationSlug: z.string().optional(),
        }),
      ),
    )
    .errors(Errors),

  cancelInvitation: oc
    .route({ method: "POST", path: "/v1/auth/invitations/cancel" })
    .input(z.object({ invitationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  acceptInvitation: oc
    .route({ method: "POST", path: "/v1/auth/invitations/accept" })
    .input(z.object({ invitationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  acceptNearInvitation: oc
    .route({ method: "POST", path: "/v1/auth/invitations/accept-near" })
    .input(z.object({ invitationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  rejectNearInvitation: oc
    .route({ method: "POST", path: "/v1/auth/invitations/reject-near" })
    .input(z.object({ invitationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),

  rejectInvitation: oc
    .route({ method: "POST", path: "/v1/auth/invitations/reject" })
    .input(z.object({ invitationId: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors(Errors),
};
