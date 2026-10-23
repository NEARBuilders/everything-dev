export const AUTH_DERIVED_TYPES_BODY = `
export type AuthSessionUser = NonNullable<InferOutput<"getSession">["user"]>;
export type AuthSessionData = NonNullable<InferOutput<"getSession">["session"]>;
export type AuthSession = {
  user: AuthSessionUser | null;
  session: AuthSessionData | null;
};
export type AuthRequestContext = InferOutput<"getContext">;
export type AuthPluginContext = Partial<AuthRequestContext> & {
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
};
`;

export function buildAuthTypesGenContent(
  authExportImportPath: string,
  contractImportPath: string,
): string {
  return `export type * from "${authExportImportPath}";
import type { InferOutput } from "${contractImportPath}";
${AUTH_DERIVED_TYPES_BODY}
`;
}

export function buildAuthExportStub(): string {
  return `export type Auth = any;
export type AuthOrganizationContext = any;
export type AuthOrganization = any;
export type AuthOrganizationSummary = any;
export type AuthOrganizationMember = any;
export type AuthApiKey = any;
export type AuthInvitation = any;
export type AuthTeam = any;
export type GetActiveMemberInput = any;
export type GetFullOrganizationInput = any;
export type ListMembersInput = any;
export type ListInvitationsInput = any;
export type ListApiKeysInput = any;
export type AuthServices = any;
export type createAuthInstance = any;
`;
}

export function buildAuthContractStub(): string {
  return `export type ContractType = any;
export type InferOutput<_TRoute extends string> = any;
`;
}
