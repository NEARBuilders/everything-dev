import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";

export const permissionRoutes = {
  getPermissionRegistry: oc
    .route({
      method: "GET",
      path: "/v1/auth/permissions",
      summary: "Get the declared permission registry",
      description:
        "Returns the permission statements, role grants, and team-area vocabulary " +
        "declared in siwn.permissions. Requires a signed-in user.",
    })
    .output(
      z.object({
        statements: z.record(z.string(), z.array(z.string())),
        roles: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
        areas: z.array(z.string()),
      }),
    )
    .errors(Errors),
};
