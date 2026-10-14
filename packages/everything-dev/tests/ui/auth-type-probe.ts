import type { AuthClient, SessionData } from "../../src/ui/auth";

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T, Msg extends string> = IsAny<T> extends true ? Msg : true;
type AssertIsAny<T, Msg extends string> = IsAny<T> extends true ? true : Msg;

export const authClientIsTyped: AssertNotAny<
  AuthClient,
  "AuthClient collapsed to any (issue #374)"
> = true;
export const sessionDataIsTyped: AssertNotAny<
  SessionData,
  "SessionData collapsed to any (issue #374)"
> = true;

export const nearNamespaceIsTyped: AssertNotAny<
  AuthClient["near"],
  "AuthClient.near collapsed to any (issue #374)"
> = true;
export const organizationNamespaceIsTyped: AssertNotAny<
  AuthClient["organization"],
  "AuthClient.organization collapsed to any (issue #374)"
> = true;
export const apiKeyNamespaceIsTyped: AssertNotAny<
  AuthClient["apiKey"],
  "AuthClient.apiKey collapsed to any (issue #374)"
> = true;
export const adminNamespaceIsTyped: AssertNotAny<
  AuthClient["admin"],
  "AuthClient.admin collapsed to any (issue #374)"
> = true;
export const passkeyNamespaceIsTyped: AssertNotAny<
  AuthClient["passkey"],
  "AuthClient.passkey collapsed to any (issue #374)"
> = true;
export const phoneNumberNamespaceIsTyped: AssertNotAny<
  AuthClient["phoneNumber"],
  "AuthClient.phoneNumber collapsed to any (issue #374)"
> = true;
export const deviceNamespaceIsTyped: AssertNotAny<
  AuthClient["device"],
  "AuthClient.device collapsed to any (issue #374)"
> = true;

export const nearGetProfileReturnIsTyped: AssertNotAny<
  Awaited<ReturnType<AuthClient["near"]["getProfile"]>>,
  "AuthClient.near.getProfile return collapsed to any (issue #374)"
> = true;
export const nearGetSupportedNetworksReturnIsTyped: AssertNotAny<
  Awaited<ReturnType<AuthClient["near"]["getSupportedNetworks"]>>,
  "AuthClient.near.getSupportedNetworks return collapsed to any (issue #374)"
> = true;
export const nearGetNearClientReturnIsTyped: AssertNotAny<
  Awaited<ReturnType<AuthClient["near"]["getNearClient"]>>,
  "AuthClient.near.getNearClient return collapsed to any (issue #374)"
> = true;
export const nearRelayHistoryReturnIsTyped: AssertNotAny<
  Awaited<ReturnType<AuthClient["near"]["relayHistory"]>>,
  "AuthClient.near.relayHistory return collapsed to any (issue #374)"
> = true;

export const getSessionDataIsAny: AssertIsAny<
  Awaited<ReturnType<AuthClient["getSession"]>>,
  "getSession data is now typed under tsgo — flip to AssertNotAny (see #374)"
> = true;
export const adminListUsersDataIsAny: AssertIsAny<
  Awaited<ReturnType<AuthClient["admin"]["listUsers"]>>,
  "admin.listUsers data is now typed under tsgo — flip to AssertNotAny (see #374)"
> = true;
export const passkeyListUserDataIsAny: AssertIsAny<
  Awaited<ReturnType<AuthClient["passkey"]["listUserPasskeys"]>>,
  "passkey.listUserPasskeys data is now typed under tsgo — flip to AssertNotAny (see #374)"
> = true;
export const organizationListMembersDataIsAny: AssertIsAny<
  Awaited<ReturnType<AuthClient["organization"]["listMembers"]>>,
  "organization.listMembers data is now typed under tsgo — flip to AssertNotAny (see #374)"
> = true;
export const apiKeyListDataIsAny: AssertIsAny<
  Awaited<ReturnType<AuthClient["apiKey"]["list"]>>,
  "apiKey.list data is now typed under tsgo — flip to AssertNotAny (see #374)"
> = true;

// @ts-expect-error AuthClient is a concrete client surface, not `any` — indexing
// it with a bogus member must fail. If this directive goes unused, AuthClient
// collapsed to `any` (issue #374).
export type AuthClientRejectsBogusMembers = AuthClient["thisMemberDoesNotExist"];
