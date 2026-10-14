import { type AuthClient, createAuthClient, type SessionData } from "../../src/ui/auth";

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertNotAny<T, Msg extends string> = IsAny<T> extends true ? Msg : true;

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

export async function probeCallSites() {
  const client = createAuthClient();
  const sess = await client.getSession();
  const list = await client.admin.listUsers({ query: {} });
  const members = await client.organization.listMembers({});
  const keys = await client.apiKey.list({ query: {} });
  const passkeys = await client.passkey.listUserPasskeys();

  const sessionDataTyped: AssertNotAny<
    typeof sess.data,
    "getSession() response data collapsed to any (issue #374)"
  > = true;
  const listDataTyped: AssertNotAny<
    (typeof list)["data"],
    "admin.listUsers() response data collapsed to any (issue #374)"
  > = true;
  const membersDataTyped: AssertNotAny<
    (typeof members)["data"],
    "organization.listMembers() response data collapsed to any (issue #374)"
  > = true;
  const keysDataTyped: AssertNotAny<
    (typeof keys)["data"],
    "apiKey.list() response data collapsed to any (issue #374)"
  > = true;
  const passkeysDataTyped: AssertNotAny<
    (typeof passkeys)["data"],
    "passkey.listUserPasskeys() response data collapsed to any (issue #374)"
  > = true;

  return {
    sessionDataTyped,
    listDataTyped,
    membersDataTyped,
    keysDataTyped,
    passkeysDataTyped,
  };
}

export const sessionUserIdIsString: AssertNotAny<
  SessionData["user"]["id"],
  "SessionData.user.id collapsed to any (issue #374)"
> = true;

// @ts-expect-error AuthClient is a concrete client surface, not `any` — indexing
// it with a bogus member must fail. If this directive goes unused, AuthClient
// collapsed to `any` (issue #374).
export type AuthClientRejectsBogusMembers = AuthClient["thisMemberDoesNotExist"];
