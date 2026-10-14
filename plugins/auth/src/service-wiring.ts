import { Layer } from "effect";
import { DatabaseTag } from "./db/layer";
import {
  AuthApiTag,
  AuthServicesTag,
  MembershipPolicyTag,
  OnboardingCodeCipherTag,
  PermissionRegistryTag,
  type PluginServices,
} from "./service-types";
import { AdminUsersService, buildAdminUsersService } from "./services/admin-users";
import { ApiKeysService, buildApiKeysService } from "./services/api-keys";
import { buildInvitationsService, InvitationsService } from "./services/invitations";
import { buildMembersService, MembersService } from "./services/members";
import { buildNearService, NearService } from "./services/near";
import { buildOnboardingService, OnboardingService } from "./services/onboarding";
import { buildOrganizationsService, OrganizationsService } from "./services/organizations";
import { buildPasskeysService, PasskeysService } from "./services/passkeys";
import { buildPermissionsService, PermissionsService } from "./services/permissions";
import { buildSessionService, SessionService } from "./services/session";
import { buildTeamsService, TeamsService } from "./services/teams";

export function buildAuthServicesLayer(services: PluginServices) {
  const permissions = buildPermissionsService({ auth: services.auth, db: services.db });
  return Layer.mergeAll(
    Layer.succeed(AuthApiTag, {
      auth: services.auth,
      handler: services.handler,
      apiKeyHeaders: services.apiKeyHeaders,
    }),
    Layer.succeed(DatabaseTag, services.db),
    Layer.succeed(OnboardingCodeCipherTag, services.onboardingCodeCipher),
    Layer.succeed(MembershipPolicyTag, services.membershipPolicy),
    Layer.succeed(PermissionRegistryTag, services.permissionRegistry),
    Layer.succeed(AuthServicesTag, services),
    Layer.succeed(
      OrganizationsService,
      buildOrganizationsService({ auth: services.auth, db: services.db }),
    ),
    Layer.succeed(
      InvitationsService,
      buildInvitationsService({ auth: services.auth, db: services.db }),
    ),
    Layer.succeed(MembersService, buildMembersService({ auth: services.auth, db: services.db })),
    Layer.succeed(
      TeamsService,
      buildTeamsService({
        auth: services.auth,
        db: services.db,
        registry: services.permissionRegistry,
      }),
    ),
    Layer.succeed(PermissionsService, permissions),
    Layer.succeed(
      OnboardingService,
      buildOnboardingService({
        auth: services.auth,
        db: services.db,
        permissions,
        cipher: services.onboardingCodeCipher,
        membershipPolicy: services.membershipPolicy,
      }),
    ),
    Layer.succeed(NearService, buildNearService({ auth: services.auth })),
    Layer.succeed(
      SessionService,
      buildSessionService({
        auth: services.auth,
        apiKeyHeaders: services.apiKeyHeaders,
        db: services.db,
        registry: services.permissionRegistry,
      }),
    ),
    Layer.succeed(PasskeysService, buildPasskeysService({ auth: services.auth })),
    Layer.succeed(ApiKeysService, buildApiKeysService({ auth: services.auth })),
    Layer.succeed(AdminUsersService, buildAdminUsersService({ auth: services.auth })),
  );
}
