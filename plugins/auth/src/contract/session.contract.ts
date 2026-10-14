import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { requestContextSchema, sessionDataSchema } from "./schemas";

export const sessionRoutes = {
  health: oc
    .route({ method: "GET", path: "/v1/auth/health" })
    .output(z.object({ status: z.literal("ok"), timestamp: z.string() })),

  getSession: oc
    .route({ method: "GET", path: "/v1/auth/session" })
    .output(sessionDataSchema)
    .errors(Errors),

  getContext: oc
    .route({ method: "GET", path: "/v1/auth/context" })
    .output(requestContextSchema)
    .errors(Errors),
};
