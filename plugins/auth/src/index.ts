import { Effect, Layer } from "effect";
import { buildScoped, createPlugin } from "every-plugin";
import { z } from "zod";

export type { AuthServices } from "./auth-export";

import { createAuthInstance } from "./auth-instance";
import { normalizeAuthConfig } from "./config";
import { authSecretsSchema, authVariablesSchema } from "./config-schemas";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createApiKeyHandlers } from "./handlers/api-keys";
import { createInvitationHandlers } from "./handlers/invitations";
import { createMemberHandlers } from "./handlers/members";
import { createNearHandlers } from "./handlers/near";
import { createOnboardingHandlers } from "./handlers/onboarding";
import { createOrganizationHandlers } from "./handlers/organizations";
import { createSessionHandlers } from "./handlers/session";
import { createTeamHandlers } from "./handlers/teams";
import type { PluginsClient } from "./lib/plugins-client.gen";
import { createRequireAuth } from "./middleware";
import { createOnboardingCodeCipher } from "./onboarding-code-cipher";
import { createOrganizationMembershipPolicy } from "./organization-membership-policy";
import { OrphanSweepLive } from "./orphan-sweep";
import { AuthServicesTag } from "./service-types";
import { toError } from "./utils";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: authVariablesSchema,

  secrets: authSecretsSchema,

  context: z.object({
    reqHeaders: z.record(z.string(), z.string()).optional(),
  }),

  contract,

  servicesTag: AuthServicesTag,

  initialize: (config) =>
    Effect.gen(function* () {
      const db = yield* buildScoped(DatabaseTag, DatabaseLive(config.secrets.AUTH_DATABASE_URL));

      const { authConfig, apiKeyHeaders } = normalizeAuthConfig(config.variables, config.secrets);

      const auth = createAuthInstance(authConfig, db, {
        email: { resend: config.secrets.RESEND_API_KEY },
      });

      console.log("[Auth] Better Auth instance created");

      return Layer.mergeAll(
        Layer.succeed(AuthServicesTag, {
          auth,
          db,
          handler: (req: Request) => auth.handler(req),
          apiKeyHeaders,
          membershipPolicy: createOrganizationMembershipPolicy(
            authConfig.organizationMembershipLimit,
          ),
          onboardingCodeCipher: createOnboardingCodeCipher(authConfig.secret),
        }),
        OrphanSweepLive(db),
      );
    }).pipe(Effect.mapError((e) => toError(e))),

  createRouter: (builder) => {
    const requireAuth = createRequireAuth(builder);

    return {
      ...createSessionHandlers(builder),
      ...createOrganizationHandlers(builder, requireAuth),
      ...createMemberHandlers(builder, requireAuth),
      ...createInvitationHandlers(builder, requireAuth),
      ...createApiKeyHandlers(builder, requireAuth),
      ...createTeamHandlers(builder, requireAuth),
      ...createNearHandlers(builder, requireAuth),
      ...createOnboardingHandlers(builder, requireAuth),
    };
  },
});
