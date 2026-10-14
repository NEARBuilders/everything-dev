import type { Implementer } from "@orpc/server";
import type { ContractType } from "../contract";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import { mapDomainError } from "../services/domain-errors";
import { PasskeysService } from "../services/passkeys";
import { createHeaders } from "../utils";

export function createPasskeyHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    listUserPasskeys: builder.listUserPasskeys.use(requireAuth).effect(function* ({ context }) {
      const passkeys = yield* PasskeysService;
      return yield* mapDomainError(passkeys.listUserPasskeys(createHeaders(context.reqHeaders)));
    }),
  };
}
