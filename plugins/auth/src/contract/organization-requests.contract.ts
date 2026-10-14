import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { organizationInfoSchema } from "./schemas";

export const organizationRequestRoutes = {
  listOrganizationRequests: oc
    .route({ method: "GET", path: "/v1/auth/admin/organization-requests" })
    .output(z.array(organizationInfoSchema.extend({ createdAt: z.date() })))
    .errors(Errors),

  reviewOrganization: oc
    .route({ method: "POST", path: "/v1/auth/admin/organization-requests/{organizationId}/review" })
    .input(
      z.discriminatedUnion("decision", [
        z.object({ organizationId: z.string(), decision: z.literal("approve") }),
        z.object({
          organizationId: z.string(),
          decision: z.literal("reject"),
          reason: z.string().trim().min(1).max(2000),
        }),
      ]),
    )
    .output(organizationInfoSchema)
    .errors(Errors),
};
