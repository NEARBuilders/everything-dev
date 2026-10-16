import type { WithEffectContext } from "@orpc/experimental-effect";
import type { Implementer } from "@orpc/server";
import type { bosContract } from "../contract";

export type BosBuilder = Implementer<
  typeof bosContract,
  Record<string, never> & WithEffectContext<any>
>;
