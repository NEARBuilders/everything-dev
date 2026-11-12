import { Effect } from "effect";
import { MISSING_CONFIG_MESSAGE } from "../config";
import type { LockResult } from "../contract";
import { lockfileOf, writeLockfile } from "../services/lockfile/schema";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerLock(builder: BosBuilder) {
  return {
    lock: builder.lock.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      if (!session?.config) {
        return { status: "error" as const, path: "", error: MISSING_CONFIG_MESSAGE };
      }
      const resolved = session.config;
      if (!resolved.domain) {
        return {
          status: "error" as const,
          path: "",
          error: `authored config for ${resolved.account} has no domain — the lockfile freezes a runtime ref (bos://<account>/<gateway>)`,
        };
      }
      const lock = lockfileOf({
        account: resolved.account,
        gateway: resolved.domain,
        config: resolved,
        release: resolved.release ?? null,
      });
      const result = yield* Effect.tryPromise({
        try: () => writeLockfile(lock, session.root, { check: input.check }),
        catch: (error) => ({
          status: "error" as const,
          path: "",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
      return {
        ...result,
        ...(result.status === "drift" ? { code: 1 as const } : {}),
      } satisfies LockResult;
    }),
  };
}
