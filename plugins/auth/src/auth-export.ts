import type { Auth as BetterAuthResult } from "better-auth";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AuthPasskeyConfig, AuthSiwnConfig } from "./auth-config";
import type { InferInput, InferOutput } from "./contract";
import type { OrganizationMembershipPolicy } from "./organization-membership-policy";

export type Auth = BetterAuthResult;
export type { Auth as BaseAuth } from "better-auth";

export type { AuthPasskeyConfig, AuthSiwnConfig };

export interface AuthConfig {
  secret: string;
  baseUrl: string;
  organizationMembershipLimit?: number;
  trustedOrigins?: string[];
  isProduction?: boolean;
  socialProviders?: {
    github?: {
      clientId?: string;
      clientSecret?: string;
    };
    google?: {
      clientId?: string;
      clientSecret?: string;
    };
  };
  passkey?: AuthPasskeyConfig;
  phoneNumber?: {
    twilio?: {
      accountSid: string;
      authToken: string;
      phoneNumber: string;
    };
  };
  siwn: AuthSiwnConfig;
  email?: {
    from: string;
  };
}

export type AuthDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export type AuthOrganizationContext = InferOutput<"getContext">["organization"];
export type AuthOrganization = NonNullable<InferOutput<"getFullOrganization">>;
export type AuthOrganizationSummary = NonNullable<AuthOrganizationContext["organization"]>;
export type AuthOrganizationMember = InferOutput<"listMembers">["members"][number];
export type AuthApiKey = InferOutput<"listApiKeys">[number];
export type AuthInvitation = InferOutput<"listInvitations">[number];
export type AuthTeam = InferOutput<"listTeams">[number];

export type GetActiveMemberInput = InferInput<"getActiveMember">;
export type GetFullOrganizationInput = InferInput<"getFullOrganization">;
export type ListMembersInput = InferInput<"listMembers">;
export type ListInvitationsInput = InferInput<"listInvitations">;
export type ListApiKeysInput = InferInput<"listApiKeys">;

export type createAuthInstance = (config: AuthConfig, db: AuthDatabase) => Auth;

export interface AuthServices {
  auth: Auth;
  db: AuthDatabase;
  handler: (req: Request) => Promise<Response>;
  apiKeyHeaders: string[];
  membershipPolicy?: OrganizationMembershipPolicy;
}
