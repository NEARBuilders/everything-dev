import "@orpc/openapi/extensions/route";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { Errors } from "./errors";
import { passkeySchema } from "./schemas";

export const passkeyRoutes = {
  listUserPasskeys: oc
    .route({
      method: "GET",
      path: "/v1/auth/passkeys",
      summary: "List the caller's passkeys",
      description: "Requires a session. Returns the passkeys registered for the caller.",
    })
    .output(z.array(passkeySchema))
    .errors(Errors),
};
