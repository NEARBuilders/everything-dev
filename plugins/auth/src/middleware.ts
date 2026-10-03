import { ORPCError } from "@orpc/server";
import { Context } from "effect";
import { AuthServicesTag } from "./service-types";
import { createHeaders } from "./utils";

export function createRequireAuth(builder: any) {
  return builder.middleware(async ({ context, next }: { context: any; next: any }) => {
    let user = context.user?.id ? context.user : null;
    if (!user) {
      const services = Context.get(context["effect/context"], AuthServicesTag);
      const headers = createHeaders(context.reqHeaders);
      const session = await services.auth.api.getSession({ headers });
      user = session?.user ?? null;
    }

    if (!user?.id) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authentication required",
      });
    }

    return next({
      context: {
        userId: user.id,
        user,
        reqHeaders: context.reqHeaders,
      },
    });
  });
}
