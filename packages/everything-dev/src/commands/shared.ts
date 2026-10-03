import type { WithEffectContext } from "@orpc/experimental-effect";
import type { Implementer } from "@orpc/server";
import { Context } from "effect";
import type { bosContract } from "../contract";
import type { DatabaseBindingsService, DrizzleKitService } from "../db";
import type { ResolutionSession } from "../resolution/session";

export type BosDeps = {
  readonly session: ResolutionSession | null;
  databaseBindings: DatabaseBindingsService;
  drizzleKit: DrizzleKitService;
};

export class BosDepsTag extends Context.Service<BosDepsTag, BosDeps>()("bos/BosDeps") {}

export type BosBuilder = Implementer<
  typeof bosContract,
  Record<string, never> & WithEffectContext<any>
>;
