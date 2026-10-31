import { Effect, Layer } from "effect";
import { buildScoped, createPlugin } from "every-plugin";
import { z } from "zod";

export type { AuthServices } from "./auth-export";

import { createAuthInstance } from "./auth-instance";
import { ensureBootstrapAdmin } from "./bootstrap-admin";
import { normalizeAuthConfig } from "./config";
import { authSecretsSchema, authVariablesSchema } from "./config-schemas";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAdminUsersHandlers } from "./handlers/admin-users";
import { createApiKeyHandlers } from "./handlers/api-keys";
import { createInvitationHandlers } from "./handlers/invitations";
import { createMemberHandlers } from "./handlers/members";
import { createNearHandlers } from "./handlers/near";
import { createOnboardingHandlers } from "./handlers/onboarding";
import { createOrganizationRequestHandlers } from "./handlers/organization-requests";
import { createOrganizationHandlers } from "./handlers/organizations";
import { createPasskeyHandlers } from "./handlers/passkeys";
import { createSessionHandlers } from "./handlers/session";
import { createTeamHandlers } from "./handlers/teams";
import type { PluginsClient } from "./lib/plugins-client.gen";
import { createRequireAuth } from "./middleware";
import { createOnboardingCodeCipher } from "./onboarding-code-cipher";
import { createOrganizationMembershipPolicy } from "./organization-membership-policy";
import { OrphanSweepLive } from "./orphan-sweep";
import { AuthServicesTag } from "./service-types";
import { buildAuthServicesLayer } from "./service-wiring";
import { toError } from "./utils";
import { socialProviderWarnings } from "./warnings";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: authVariablesSchema,

  secrets: authSecretsSchema,

  context: z.object({
    reqHeaders: z.record(z.string(), z.string()).optional(),
  }),

  contract,

  servicesTag: AuthServicesTag,

  warnings: socialProviderWarnings,

  initialize: (config) =>
    Effect.gen(function* () {
      const db = yield* buildScoped(DatabaseTag, DatabaseLive(config));

      const { authConfig, apiKeyHeaders } = normalizeAuthConfig(config.variables, config.secrets);

      const auth = createAuthInstance(authConfig, db, {
        email: { resend: config.secrets.RESEND_API_KEY },
      });
      const handler = (req: Request) => auth.handler(req);
      const membershipPolicy = createOrganizationMembershipPolicy(
        authConfig.organizationMembershipLimit,
      );
      const onboardingCodeCipher = createOnboardingCodeCipher(authConfig.secret);
      const permissionRegistry = {
        statements: authConfig.siwn.permissions.statements,
        roleGrants: authConfig.siwn.permissions.roles,
      };

      yield* Effect.log("[Auth] Better Auth instance created");

      if (config.secrets.AUTH_BOOTSTRAP_ADMIN_API_KEY) {
        yield* ensureBootstrapAdmin({
          db,
          secret: config.secrets.AUTH_BOOTSTRAP_ADMIN_API_KEY,
        });
        yield* Effect.logWarning(
          "[Auth] bootstrap admin enabled via AUTH_BOOTSTRAP_ADMIN_API_KEY — dev/test seeding only, never set in production",
        );
      }

      return Layer.mergeAll(
        buildAuthServicesLayer({
          auth,
          db,
          handler,
          apiKeyHeaders,
          membershipPolicy,
          onboardingCodeCipher,
          permissionRegistry,
        }),
        OrphanSweepLive(db),
      );
    }).pipe(Effect.mapError((e) => toError(e))),

  createRouter: (builder) => {
    const requireAuth = createRequireAuth(builder);

    return {
      ...createSessionHandlers(builder),
      ...createPasskeyHandlers(builder, requireAuth),
      ...createOrganizationHandlers(builder, requireAuth),
      ...createOrganizationRequestHandlers(builder, requireAuth),
      ...createMemberHandlers(builder, requireAuth),
      ...createInvitationHandlers(builder, requireAuth),
      ...createApiKeyHandlers(builder, requireAuth),
      ...createTeamHandlers(builder, requireAuth),
      ...createAdminUsersHandlers(builder, requireAuth),
      ...createNearHandlers(builder, requireAuth),
      ...createOnboardingHandlers(builder, requireAuth),
    };
  },
});
