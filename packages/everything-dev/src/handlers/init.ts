import type { InitResult } from "../contract";
import { InitFlowService } from "../services/scaffold/init-flow";
import type { BosBuilder } from "./shared";

export { fetchInitParent } from "../services/scaffold/init-flow";

export function registerInit(builder: BosBuilder) {
  return {
    init: builder.init.effect(function* (_opts, input) {
      const flow = yield* InitFlowService;
      return yield* flow.run(input);
    }),
  };
}
