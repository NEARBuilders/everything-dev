import { Effect } from "effect";
import { runSmoke } from "../services/deploy/smoke";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerSmoke(builder: BosBuilder) {
  return {
    smoke: builder.smoke.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const account = input.account ?? session?.config?.account;
      const gateway = input.gateway ?? session?.config?.domain;

      const image = input.image;
      if (!image) {
        return {
          status: "error" as const,
          error: "smoke requires an image ref — pass --image <ref>",
        };
      }

      console.log(`smoke: booting ${image} on :${input.port}`);
      const result = yield* Effect.tryPromise(() =>
        runSmoke({
          image,
          port: input.port,
          keep: input.keep,
          ...(account ? { account } : {}),
          ...(gateway ? { gateway } : {}),
          ...(input.apiDatabaseUrl ? { apiDatabaseUrl: input.apiDatabaseUrl } : {}),
          ...(input.authDatabaseUrl ? { authDatabaseUrl: input.authDatabaseUrl } : {}),
        }),
      );

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
