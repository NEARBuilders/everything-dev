import { ORPCError } from "@orpc/server";
import { Data, Effect, Schema } from "effect";

export class AuthApiError extends Data.TaggedError("AuthApiError")<{
  code: string;
  data: Record<string, unknown>;
  message?: string;
  cause?: unknown;
}> {}

export class DbError extends Data.TaggedError("DbError")<{
  message?: string;
  cause?: unknown;
}> {}

export class OrgNotFound extends Schema.TaggedError<OrgNotFound>()("OrgNotFound", {
  message: Schema.String,
  organizationId: Schema.optional(Schema.String),
}) {}

export class OrgApprovalRequired extends Schema.TaggedError<OrgApprovalRequired>()(
  "OrgApprovalRequired",
  { message: Schema.String, action: Schema.String },
) {}

export class OrgRequiresApproval extends Schema.TaggedError<OrgRequiresApproval>()(
  "OrgRequiresApproval",
  { message: Schema.String },
) {}

export class NoActiveOrganization extends Schema.TaggedError<NoActiveOrganization>()(
  "NoActiveOrganization",
  { message: Schema.String },
) {}

export class NoOrganizationSelected extends Schema.TaggedError<NoOrganizationSelected>()(
  "NoOrganizationSelected",
  { message: Schema.String },
) {}

export class MemberCreateNotPermitted extends Schema.TaggedError<MemberCreateNotPermitted>()(
  "MemberCreateNotPermitted",
  { message: Schema.String },
) {}

export class OwnerRoleRequired extends Schema.TaggedError<OwnerRoleRequired>()(
  "OwnerRoleRequired",
  { message: Schema.String },
) {}

export class MemberEmailsExportForbidden extends Schema.TaggedError<MemberEmailsExportForbidden>()(
  "MemberEmailsExportForbidden",
  { message: Schema.String },
) {}

export class RejectionReasonRequired extends Schema.TaggedError<RejectionReasonRequired>()(
  "RejectionReasonRequired",
  { message: Schema.String },
) {}

export class OrganizationNotPending extends Schema.TaggedError<OrganizationNotPending>()(
  "OrganizationNotPending",
  { message: Schema.String },
) {}

export class OrganizationRequesterMissing extends Schema.TaggedError<OrganizationRequesterMissing>()(
  "OrganizationRequesterMissing",
  { message: Schema.String },
) {}

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()("TeamNotFound", {
  message: Schema.String,
  teamId: Schema.String,
}) {}

export class TeamUpdateFailed extends Schema.TaggedError<TeamUpdateFailed>()("TeamUpdateFailed", {
  message: Schema.String,
}) {}

export class NotOrgMember extends Schema.TaggedError<NotOrgMember>()("NotOrgMember", {
  message: Schema.String,
}) {}

export class NotOrganizer extends Schema.TaggedError<NotOrganizer>()("NotOrganizer", {
  message: Schema.String,
}) {}

export class PlatformAdminRequired extends Schema.TaggedError<PlatformAdminRequired>()(
  "PlatformAdminRequired",
  { message: Schema.String },
) {}

export class EventEnded extends Schema.TaggedError<EventEnded>()("EventEnded", {
  message: Schema.String,
}) {}

export class CodeCreateFailed extends Schema.TaggedError<CodeCreateFailed>()("CodeCreateFailed", {
  message: Schema.String,
}) {}

export class CodeNotFound extends Schema.TaggedError<CodeNotFound>()("CodeNotFound", {
  message: Schema.String,
  codeId: Schema.optional(Schema.String),
}) {}

export class CodeInactive extends Schema.TaggedError<CodeInactive>()("CodeInactive", {
  message: Schema.String,
}) {}

export class AuthenticationRequired extends Schema.TaggedError<AuthenticationRequired>()(
  "AuthenticationRequired",
  { message: Schema.String },
) {}

export class CodeRevoked extends Schema.TaggedError<CodeRevoked>()("CodeRevoked", {
  message: Schema.String,
}) {}

export class CodeExpired extends Schema.TaggedError<CodeExpired>()("CodeExpired", {
  message: Schema.String,
}) {}

export class CodeLimitReached extends Schema.TaggedError<CodeLimitReached>()("CodeLimitReached", {
  message: Schema.String,
}) {}

export class RedeemOrgMissing extends Schema.TaggedError<RedeemOrgMissing>()("RedeemOrgMissing", {
  message: Schema.String,
}) {}

export class OrgFull extends Schema.TaggedError<OrgFull>()("OrgFull", {
  message: Schema.String,
}) {}

export class EventTeamCreateFailed extends Schema.TaggedError<EventTeamCreateFailed>()(
  "EventTeamCreateFailed",
  { message: Schema.String },
) {}

export class InviteeAmbiguous extends Schema.TaggedError<InviteeAmbiguous>()("InviteeAmbiguous", {
  message: Schema.String,
}) {}

export class NearNetworkOnEmailInvite extends Schema.TaggedError<NearNetworkOnEmailInvite>()(
  "NearNetworkOnEmailInvite",
  { message: Schema.String },
) {}

export class InvalidNearAccountId extends Schema.TaggedError<InvalidNearAccountId>()(
  "InvalidNearAccountId",
  { message: Schema.String },
) {}

export class NearNetworkRequired extends Schema.TaggedError<NearNetworkRequired>()(
  "NearNetworkRequired",
  { message: Schema.String },
) {}

export class ApiKeyNotFound extends Schema.TaggedError<ApiKeyNotFound>()("ApiKeyNotFound", {
  message: Schema.String,
  keyId: Schema.String,
}) {}

export class UnknownTeamRole extends Schema.TaggedError<UnknownTeamRole>()("UnknownTeamRole", {
  message: Schema.String,
}) {}

export class DeployKeyAccountNotLinked extends Schema.TaggedError<DeployKeyAccountNotLinked>()(
  "DeployKeyAccountNotLinked",
  { message: Schema.String, action: Schema.String },
) {}

const FAILURE_TAGS = new Set([
  "AuthApiError",
  "DbError",
  "OrgNotFound",
  "OrgApprovalRequired",
  "OrgRequiresApproval",
  "NoActiveOrganization",
  "NoOrganizationSelected",
  "MemberCreateNotPermitted",
  "OwnerRoleRequired",
  "MemberEmailsExportForbidden",
  "RejectionReasonRequired",
  "OrganizationNotPending",
  "OrganizationRequesterMissing",
  "TeamNotFound",
  "TeamUpdateFailed",
  "NotOrgMember",
  "NotOrganizer",
  "PlatformAdminRequired",
  "EventEnded",
  "CodeCreateFailed",
  "CodeNotFound",
  "CodeInactive",
  "AuthenticationRequired",
  "CodeRevoked",
  "CodeExpired",
  "CodeLimitReached",
  "RedeemOrgMissing",
  "OrgFull",
  "EventTeamCreateFailed",
  "InviteeAmbiguous",
  "NearNetworkOnEmailInvite",
  "InvalidNearAccountId",
  "NearNetworkRequired",
  "ApiKeyNotFound",
  "UnknownTeamRole",
  "DeployKeyAccountNotLinked",
]);

export const isAuthFailure = (error: unknown): error is AuthFailure =>
  typeof (error as { _tag?: unknown })?._tag === "string" &&
  FAILURE_TAGS.has((error as { _tag: string })._tag);

export type AuthFailure =
  | AuthApiError
  | DbError
  | OrgNotFound
  | OrgApprovalRequired
  | OrgRequiresApproval
  | NoActiveOrganization
  | NoOrganizationSelected
  | MemberCreateNotPermitted
  | OwnerRoleRequired
  | MemberEmailsExportForbidden
  | RejectionReasonRequired
  | OrganizationNotPending
  | OrganizationRequesterMissing
  | TeamNotFound
  | TeamUpdateFailed
  | NotOrgMember
  | NotOrganizer
  | PlatformAdminRequired
  | EventEnded
  | CodeCreateFailed
  | CodeNotFound
  | CodeInactive
  | AuthenticationRequired
  | CodeRevoked
  | CodeExpired
  | CodeLimitReached
  | RedeemOrgMissing
  | OrgFull
  | EventTeamCreateFailed
  | InviteeAmbiguous
  | NearNetworkOnEmailInvite
  | InvalidNearAccountId
  | NearNetworkRequired
  | ApiKeyNotFound
  | UnknownTeamRole
  | DeployKeyAccountNotLinked;

export function toTransportError(error: AuthFailure): ORPCError<string, unknown> {
  switch (error._tag) {
    case "AuthApiError":
      return new ORPCError(error.code, { message: error.message, data: error.data });
    case "DbError":
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error.message,
        ...(error.cause !== undefined ? { cause: error.cause } : {}),
      });
    case "OrgNotFound":
      return new ORPCError("NOT_FOUND", {
        message: error.message,
        data: {
          resource: "organization",
          ...(error.organizationId ? { resourceId: error.organizationId } : {}),
        },
      });
    case "OrgApprovalRequired":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { action: error.action },
      });
    case "OrgRequiresApproval":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "NoActiveOrganization":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "NoOrganizationSelected":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "MemberCreateNotPermitted":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { requiredPermissions: ["member:create"] },
      });
    case "OwnerRoleRequired":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { action: "add-owner" },
      });
    case "MemberEmailsExportForbidden":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "RejectionReasonRequired":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "OrganizationNotPending":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "OrganizationRequesterMissing":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "TeamNotFound":
      return new ORPCError("NOT_FOUND", {
        message: error.message,
        data: { resource: "team", resourceId: error.teamId },
      });
    case "TeamUpdateFailed":
      return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
    case "NotOrgMember":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "NotOrganizer":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { action: "manage-onboarding" },
      });
    case "PlatformAdminRequired":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { action: "view-onboarding-stats" },
      });
    case "EventEnded":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "CodeCreateFailed":
      return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
    case "CodeNotFound":
      return new ORPCError("NOT_FOUND", {
        message: error.message,
        data: { resource: "onboardingCode", ...(error.codeId ? { resourceId: error.codeId } : {}) },
      });
    case "CodeInactive":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "AuthenticationRequired":
      return new ORPCError("UNAUTHORIZED", {
        message: error.message,
        data: { apiKeyProvided: false },
      });
    case "CodeRevoked":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "CodeExpired":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "CodeLimitReached":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "RedeemOrgMissing":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "OrgFull":
      return new ORPCError("FORBIDDEN", { message: error.message, data: {} });
    case "EventTeamCreateFailed":
      return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
    case "InviteeAmbiguous":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "NearNetworkOnEmailInvite":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "InvalidNearAccountId":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "NearNetworkRequired":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "ApiKeyNotFound":
      return new ORPCError("NOT_FOUND", {
        message: error.message,
        data: { resource: "apiKey", resourceId: error.keyId },
      });
    case "UnknownTeamRole":
      return new ORPCError("BAD_REQUEST", { message: error.message, data: {} });
    case "DeployKeyAccountNotLinked":
      return new ORPCError("FORBIDDEN", {
        message: error.message,
        data: { action: error.action },
      });
  }
}

export function mapDomainError<A, E extends AuthFailure>(
  self: Effect.Effect<A, E, never>,
): Effect.Effect<A, ORPCError<string, unknown>, never> {
  return Effect.catch(self, (error) => Effect.fail(toTransportError(error)));
}
