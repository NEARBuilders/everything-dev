import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  admin,
  anonymous,
  deviceAuthorization,
  organization,
  phoneNumber,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { DEFAULT_DEVICE_LINK_CLIENT_ID, type SIWNPluginOptions, siwn } from "better-near-auth";
import { gt } from "drizzle-orm";
import { BOS_CLI_CLIENT_ID, deviceLink } from "./device-link";
import {
  createPasskeySignUpUser,
  passkeyAuthenticatorSelection,
  passkeySignUp,
  requireUserVerifiedSignIn,
  requireWalletCapablePasskey,
} from "./passkey-sign-up";

const orgStatements = {
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
} as const;

const orgAc = createAccessControl(orgStatements);

const orgRoles = {
  owner: orgAc.newRole({
    ...ownerAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  admin: orgAc.newRole({
    ...adminAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  member: orgAc.newRole({
    ...memberAc.statements,
    apiKey: ["read"],
  }),
};

import type { AuthConfig } from "./auth-config";
import type { Database as AuthDatabase } from "./db";
import * as schema from "./db/schema";
import {
  isNearInvitation,
  isNearNetwork,
  nearInvitationEmail,
  nearInvitations,
  normalizeNearAccountId,
} from "./near-invitations";
import { createOrganizationMembershipPolicy } from "./organization-membership-policy";

export function isRecipientsConfig(config: SIWNPluginOptions): config is SIWNPluginOptions & {
  recipients: { mainnet: string; testnet: string };
} {
  return "recipients" in config && config.recipients !== undefined;
}

export interface PasskeyRelyingPartyOptions {
  rpID: string;
  rpName: string;
  origin: string[];
}

function normalizeOrigin(value: string): string {
  try {
    if (/^https?:\/\//i.test(value)) {
      return new URL(value).origin;
    }
    const hostname = new URL(`https://${value}`).hostname;
    const protocol = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
    return new URL(`${protocol}://${value}`).origin;
  } catch {
    throw new Error(`Invalid passkey origin value: "${value}". Must be a valid URL or hostname.`);
  }
}

function normalizeRpId(value: string): string {
  try {
    const hostname = /^https?:\/\//i.test(value)
      ? new URL(value).hostname
      : new URL(`https://${value}`).hostname;
    if (!hostname) {
      throw new TypeError("Missing hostname");
    }
    return hostname;
  } catch {
    throw new Error(`Invalid passkey RP ID value: "${value}". Must be a valid domain or URL.`);
  }
}

function isLocalOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function resolvePasskeyRelyingPartyOptions(
  config: Pick<AuthConfig, "baseUrl" | "passkey" | "network">,
): PasskeyRelyingPartyOptions {
  const passkey = config.passkey;
  const origin = normalizeOrigin(passkey?.origin?.trim() || config.baseUrl);
  const localDev = isLocalOrigin(origin) && process.env.PASSKEY_RPID === undefined;
  const rpID =
    !localDev && passkey?.rpID?.trim()
      ? normalizeRpId(passkey.rpID.trim())
      : new URL(origin).hostname;
  const rpName = passkey?.rpName?.trim() || "Everything Dev";
  const gatewayOrigins = (passkey?.gatewayOrigins?.[config.network ?? "mainnet"] ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return { rpID, rpName, origin: [...new Set([origin, ...gatewayOrigins])] };
}

export function buildSiwnOptions(config: AuthConfig): Parameters<typeof siwn>[0] {
  const base = {
    passkeyWalletNetwork: config.network ?? "mainnet",
    apiKey: config.siwn.apiKey,
    rpcUrl: config.siwn.rpcUrl,
    relayer: config.siwn.relayer,
    sessionGasKey: config.siwn.sessionGasKey,
    subAccount: config.siwn.subAccount,
  };

  if (isRecipientsConfig(config.siwn)) {
    return {
      ...base,
      recipients: {
        mainnet: config.siwn.recipients.mainnet,
        testnet: config.siwn.recipients.testnet,
      },
    };
  }

  return {
    ...base,
    recipient: config.siwn.recipient,
  };
}

async function sendEmail(
  { to, subject, text, html }: { to: string; subject: string; text: string; html?: string },
  emailApiKey?: string,
  from?: string,
) {
  try {
    if (!emailApiKey || !from) {
      throw new Error("no email API key or from address configured");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emailApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Resend error ${res.status}: ${errorText}`);
    }
  } catch (err) {
    console.log(`\n📧 [Email Preview — ${err instanceof Error ? err.message : "send failed"}] ===`);
    console.log(`To: ${to}`);
    console.log(`From: ${from ?? "(not configured)"}`);
    console.log(`Subject: ${subject}`);
    console.log(`----------------------------------------------------------------`);
    console.log(text);
    if (html) {
      console.log(`\n[HTML version available but not shown in console]`);
    }
    console.log(`================================================================\n`);
  }
}

async function sendSMS(
  { phoneNumber, code }: { phoneNumber: string; code: string },
  twilio?: { accountSid: string; authToken: string; phoneNumber: string },
) {
  if (twilio) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: phoneNumber,
      From: twilio.phoneNumber,
      Body: `Your verification code is: ${code}`,
    });
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${btoa(`${twilio.accountSid}:${twilio.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Twilio error ${res.status}: ${text}`);
    }
    return;
  }

  console.log(`\n📱 [SMS Preview] ================================================`);
  console.log(`To: ${phoneNumber}`);
  console.log(`Code: ${code}`);
  console.log(`Message: Your verification code is: ${code}`);
  console.log(`================================================================\n`);
}

async function createPersonalOrganization(
  database: AuthDatabase,
  user: { id: string; name?: string; email?: string; isAnonymous?: boolean },
) {
  if (user.isAnonymous) {
    return null;
  }

  const existingOrg = await database.query.organization.findFirst({
    where: (org, { eq, and }) =>
      and(eq(org.slug, user.id), eq(org.metadata, JSON.stringify({ isPersonal: true }))),
  });

  if (existingOrg) {
    return existingOrg;
  }

  const [personalOrg] = await database
    .insert(schema.organization)
    .values({
      id: crypto.randomUUID(),
      name: user.name || "My Organization",
      slug: user.id,
      logo: null,
      metadata: JSON.stringify({ isPersonal: true }),
      createdAt: new Date(),
    })
    .returning();

  if (!personalOrg) {
    throw new Error("Failed to create personal organization");
  }

  await database.insert(schema.member).values({
    id: crypto.randomUUID(),
    userId: user.id,
    organizationId: personalOrg.id,
    role: "owner",
    createdAt: new Date(),
  });

  return personalOrg;
}

export function createAuthInstance(
  config: AuthConfig,
  db: AuthDatabase,
  secrets?: { email?: { resend?: string } },
) {
  const emailApiKey = secrets?.email?.resend;
  const emailConfig = config.email;
  const passkeyOptions = resolvePasskeyRelyingPartyOptions(config);
  const twilioConfig = config.phoneNumber?.twilio;
  const githubConfig = config.socialProviders?.github;
  const googleConfig = config.socialProviders?.google;
  const network = config.network ?? "mainnet";
  const siwnOptions = buildSiwnOptions(config);
  const membershipPolicy = createOrganizationMembershipPolicy(config.organizationMembershipLimit);
  const deviceClientIds = new Set([
    config.deviceLink?.clientId ?? DEFAULT_DEVICE_LINK_CLIENT_ID,
    BOS_CLI_CLIENT_ID,
  ]);
  const mainnetRecipient = isRecipientsConfig(siwnOptions)
    ? siwnOptions.recipients.mainnet
    : siwnOptions.recipient;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    trustedOrigins: config.trustedOrigins?.length ? config.trustedOrigins : undefined,
    secret: config.secret,
    baseURL: config.baseUrl,
    // better-auth's core limiter defaults to enabled in production with a
    // single shared per-path bucket when no client IP is resolvable — the
    // regression container's whole /api/auth/* traffic shares one bucket and
    // trips it within seconds. Test environments opt out explicitly.
    ...(process.env.BETTER_AUTH_RATE_LIMIT_DISABLED === "1"
      ? { rateLimit: { enabled: false } }
      : {}),
    socialProviders: {
      github: {
        clientId: githubConfig?.clientId ?? "",
        clientSecret: githubConfig?.clientSecret ?? "",
      },
      google: {
        clientId: googleConfig?.clientId ?? "",
        clientSecret: googleConfig?.clientSecret ?? "",
      },
    },
    plugins: [
      siwn(siwnOptions),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      anonymous({ emailDomainName: mainnetRecipient }),
      ...(twilioConfig
        ? [
            phoneNumber({
              sendOTP: async ({ phoneNumber, code }) => {
                await sendSMS({ phoneNumber, code }, twilioConfig);
              },
              signUpOnVerification: {
                getTempEmail: (phoneNumber) => `${phoneNumber}@${mainnetRecipient}`,
                getTempName: (phoneNumber) => phoneNumber,
              },
            }),
          ]
        : []),
      passkey({
        ...passkeyOptions,
        authenticatorSelection: passkeyAuthenticatorSelection,
        authentication: { afterVerification: requireUserVerifiedSignIn },
        registration: {
          requireSession: false,
          afterVerification: requireWalletCapablePasskey,
          resolveUser: (args) => createPasskeySignUpUser(args, mainnetRecipient),
        },
      }),
      passkeySignUp({ network }),
      organization({
        ac: orgAc,
        roles: orgRoles,
        membershipLimit: membershipPolicy.limit,
        teams: {
          enabled: true,
          defaultTeam: { enabled: false },
          allowRemovingAllTeams: true,
        },
        schema: {
          team: {
            additionalFields: {
              metadata: { type: "string", required: false, input: true },
            },
          },
          invitation: {
            additionalFields: {
              nearAccountId: { type: "string", required: false, input: true },
              nearNetwork: { type: "string", required: false, input: true },
            },
          },
        },
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            const accountId =
              typeof invitation.nearAccountId === "string" ? invitation.nearAccountId : undefined;
            const suppliedNetwork = invitation.nearNetwork;
            if (accountId) {
              const normalizedAccountId = normalizeNearAccountId(accountId);
              if (!normalizedAccountId) {
                throw new APIError("BAD_REQUEST", { message: "Invalid NEAR account id" });
              }
              if (!isNearNetwork(suppliedNetwork)) {
                throw new APIError("BAD_REQUEST", {
                  message: "A wallet invitation requires a mainnet or testnet network",
                });
              }
              const duplicate = await db.query.invitation.findFirst({
                where: (stored, { and, eq }) =>
                  and(
                    eq(stored.organizationId, invitation.organizationId),
                    eq(stored.status, "pending"),
                    gt(stored.expiresAt, new Date()),
                    eq(stored.nearAccountId, normalizedAccountId),
                    eq(stored.nearNetwork, suppliedNetwork),
                  ),
              });
              if (duplicate) {
                throw new APIError("BAD_REQUEST", {
                  message: "Wallet invitation already exists for this account and network",
                });
              }
              return {
                data: {
                  ...invitation,
                  email: nearInvitationEmail(normalizedAccountId, suppliedNetwork),
                  nearAccountId: normalizedAccountId,
                  nearNetwork: suppliedNetwork,
                },
              };
            }
            if (suppliedNetwork !== undefined) {
              throw new APIError("BAD_REQUEST", {
                message: "A NEAR network can only be supplied for wallet invitations",
              });
            }
            return undefined;
          },
          beforeAcceptInvitation: async ({ invitation }) => {
            if (isNearInvitation(invitation)) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Wallet invitations are accepted by signing in with the invited NEAR account",
              });
            }
          },
        },
        async sendInvitationEmail(data) {
          if (isNearInvitation(data.invitation)) return;
          const inviteLink = `${config.baseUrl}/orgs/invites/${data.id}`;
          await sendEmail(
            {
              to: data.email,
              subject: `Invitation to join ${data.organization.name}`,
              text: `You've been invited by ${data.inviter.user.name} (${data.inviter.user.email}) to join ${data.organization.name}.\n\nClick here to accept: ${inviteLink}`,
            },
            emailApiKey,
            emailConfig?.from,
          );
        },
      }),
      nearInvitations(db, membershipPolicy),
      deviceAuthorization({
        verificationUri: "/login/device",
        validateClient: (clientId) => deviceClientIds.has(clientId),
      }),
      deviceLink(db),
      apiKey([
        {
          configId: "user-keys",
          defaultPrefix: "api_",
          references: "user",
          enableSessionForAPIKeys: true,
          enableMetadata: true,
          maximumNameLength: 64,
          rateLimit: {
            enabled: true,
            timeWindow: 60 * 1000,
            maxRequests: 1000,
          },
        },
        {
          configId: "org-keys",
          defaultPrefix: "org_",
          references: "organization",
          enableMetadata: true,
          maximumNameLength: 64,
          rateLimit: {
            enabled: true,
            timeWindow: 60 * 1000,
            maxRequests: 1000,
          },
        },
      ]),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          {
            to: user.email,
            subject: "Reset your password",
            text: `Click the link to reset your password: ${url}`,
          },
          emailApiKey,
          emailConfig?.from,
        );
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          {
            to: user.email,
            subject: "Verify your email address",
            text: `Click the link to verify your email: ${url}`,
          },
          emailApiKey,
          emailConfig?.from,
        );
      },
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const userData = user as typeof schema.user.$inferInsert & { isAnonymous?: boolean };
            if (!userData.isAnonymous) {
              await createPersonalOrganization(db, user);
            }
          },
        },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["siwn", "email-password"],
        allowDifferentEmails: true,
        updateUserInfoOnLink: true,
      },
    },
    advanced: {
      // One switch for the Secure attribute and the __Secure- name prefix,
      // derived from the baseURL protocol — not NODE_ENV. An https baseURL
      // (production, staging) keeps Secure cookies; an http baseURL (the
      // regression container serving http://localhost:<port> in production
      // mode) must issue cookies plain clients can send back.
      useSecureCookies: config.baseUrl.startsWith("https://"),
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuthInstance>;
export type AuthSession = Auth["$Infer"]["Session"];
export type { AuthConfig } from "./auth-config";
