import { Context } from "effect";
import type { Auth as ConfiguredAuth } from "./auth-instance";
import type { Database } from "./db";
import type { OnboardingCodeCipher } from "./onboarding-code-cipher";
import type { OrganizationMembershipPolicy } from "./organization-membership-policy";

export type PermissionRegistry = {
  statements: Record<string, string[]>;
  roleGrants: Record<string, Record<string, string[]>>;
};

export type PluginServices = {
  auth: ConfiguredAuth;
  db: Database;
  handler: (req: Request) => Promise<Response>;
  apiKeyHeaders: string[];
  membershipPolicy: OrganizationMembershipPolicy;
  onboardingCodeCipher: OnboardingCodeCipher;
  permissionRegistry: PermissionRegistry;
};

export class AuthApiTag extends Context.Service<
  AuthApiTag,
  {
    auth: ConfiguredAuth;
    handler: (req: Request) => Promise<Response>;
    apiKeyHeaders: string[];
  }
>()("auth/AuthApi") {}

export class OnboardingCodeCipherTag extends Context.Service<
  OnboardingCodeCipherTag,
  OnboardingCodeCipher
>()("auth/OnboardingCodeCipher") {}

export class MembershipPolicyTag extends Context.Service<
  MembershipPolicyTag,
  OrganizationMembershipPolicy
>()("auth/MembershipPolicy") {}

export class PermissionRegistryTag extends Context.Service<
  PermissionRegistryTag,
  PermissionRegistry
>()("auth/PermissionRegistry") {}

export class AuthServicesTag extends Context.Service<AuthServicesTag, PluginServices>()(
  "auth/AuthServices",
) {}
