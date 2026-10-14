import { Context } from "effect";
import { runSmoke } from "../smoke";
import { type BosBuilder, BosDepsTag } from "./shared";

export function registerSmoke(builder: BosBuilder) {
  return {
    smoke: builder.smoke.handler(async ({ input, context }) => {
      const deps = Context.get(context["effect/context"], BosDepsTag);
      const account = input.account ?? deps.session?.config?.account;
      const gateway = input.gateway ?? deps.session?.config?.domain;

      if (!input.image) {
        return {
          status: "error" as const,
          error: "smoke requires an image ref — pass --image <ref>",
        };
      }

      console.log(`smoke: booting ${input.image} on :${input.port}`);
      const result = await runSmoke({
        image: input.image,
        port: input.port,
        keep: input.keep,
        ...(account ? { account } : {}),
        ...(gateway ? { gateway } : {}),
        ...(input.apiDatabaseUrl ? { apiDatabaseUrl: input.apiDatabaseUrl } : {}),
        ...(input.authDatabaseUrl ? { authDatabaseUrl: input.authDatabaseUrl } : {}),
      });

      if (result.ok) {
        return {
          status: "ok" as const,
          image: result.image,
          summary: result.summary,
        };
      }
      return {
        status: "error" as const,
        image: result.image,
        ...(result.diagnosis ? { diagnosis: result.diagnosis } : {}),
        error: result.error,
      };
    }),
  };
}
