import { Effect } from "effect";
import { MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../config";
import {
  type VerifyFreshness,
  type VerifyRemoteResult,
  verifyPublishedPins,
  verifyReleaseFreshness,
} from "../services/deploy/verify";
import { resolvePublishedConfig } from "../services/registry/published";
import type { BosConfig, BosConfigInput } from "../types";
import type { BosBuilder } from "./shared";

export function registerVerify(builder: BosBuilder) {
  return {
    verify: builder.verify.effect(function* (_opts, input) {
      return yield* Effect.promise(async () => {
        let authored: BosConfig | null = null;
        try {
          authored = (await readAuthoredConfigInput()) as BosConfig | null;
        } catch (error) {
          return {
            status: "fail" as const,
            remotes: [] as VerifyRemoteResult[],
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (!authored) {
          const account = process.env.BOS_ACCOUNT;
          const gateway = process.env.BOS_GATEWAY;
          if (!account || !gateway) {
            return {
              status: "fail" as const,
              remotes: [] as VerifyRemoteResult[],
              error: MISSING_CONFIG_MESSAGE,
            };
          }
          try {
            authored = (await resolvePublishedConfig(account, gateway)) as BosConfig | null;
          } catch (error) {
            return {
              status: "fail" as const,
              remotes: [] as VerifyRemoteResult[],
              error: error instanceof Error ? error.message : String(error),
            };
          }
          if (!authored) {
            return {
              status: "fail" as const,
              remotes: [] as VerifyRemoteResult[],
              error: `No config found at bos://${account}/${gateway} — verify BOS_ACCOUNT/BOS_GATEWAY and that the config has been published.`,
            };
          }
        }

        const config: BosConfigInput = authored as unknown as BosConfigInput;
        const report = await verifyPublishedPins({ config });
        const freshness = await verifyReleaseFreshness({
          config,
          ...(input.registry ? { registry: input.registry } : {}),
        });
        const rot = report.remotes.some(
          (remote) => !remote.manifestOk || remote.mismatches.length > 0,
        );
        const behind = freshness?.behind === true;
        return {
          status: rot ? ("fail" as const) : behind ? ("drift" as const) : ("ok" as const),
          remotes: report.remotes,
          ...(freshness ? { freshness: freshness as VerifyFreshness } : {}),
        };
      });
    }),
  };
}
