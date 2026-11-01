import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext } from "../middleware";
import { mapDomainError } from "../services/domain-errors";
import { SessionService } from "../services/session";
import { createHeaders } from "../utils";

export function createSessionHandlers(builder: Implementer<ContractType, AuthHandlerContext>) {
  return {
    health: builder.health.effect(function* () {
      const session = yield* SessionService;
      return yield* mapDomainError(session.health);
    }),

    getSession: builder.getSession.effect(function* ({ context }) {
      const session = yield* SessionService;
      return yield* mapDomainError(session.getSession(createHeaders(context.reqHeaders)));
    }),

    getContext: builder.getContext.effect(function* ({ context }) {
      const session = yield* SessionService;
      return yield* mapDomainError(
        session.getContext(createHeaders(context.reqHeaders), context.session),
      );
    }),
  };
}
