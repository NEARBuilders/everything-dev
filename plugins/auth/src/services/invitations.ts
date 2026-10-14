import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import {
  isNearNetwork,
  listPendingNearInvitations,
  nearInvitationEmail,
  normalizeNearAccountId,
} from "../near-invitations";
import {
  AuthApiError,
  InviteeAmbiguous,
  InvalidNearAccountId,
  NearNetworkOnEmailInvite,
  NearNetworkRequired,
  type AuthFailure,
} from "./domain-errors";
import { toInvitation } from "../serializers";
import { AuthApiTag, type PluginServices } from "../service-types";
import { canReadMemberEmails, type EmailVisibilityContext } from "../utils";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

export class InvitationsService extends Context.Service<
  InvitationsService,
  {
    inviteMember: (
      headers: Headers,
      input: {
        email?: string;
        nearAccountId?: string;
        nearNetwork?: "mainnet" | "testnet";
        role: "owner" | "admin" | "member";
        organizationId?: string;
        resend?: boolean;
        teamId?: string;
      },
    ) => Effect.Effect<any, AuthFailure>;
    getInvitation: (headers: Headers, id: string) => Effect.Effect<any, AuthFailure>;
    listInvitations: (
      headers: Headers,
      emailContext: EmailVisibilityContext,
      organizationId: string | undefined,
    ) => Effect.Effect<any, AuthFailure>;
    listUserInvitations: (
      headers: Headers,
      input: { userId: string; emailUnverified: boolean },
    ) => Effect.Effect<any, AuthFailure>;
    cancelInvitation: (
      headers: Headers,
      invitationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    acceptInvitation: (
      headers: Headers,
      invitationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    acceptNearInvitation: (
      headers: Headers,
      invitationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    rejectNearInvitation: (
      headers: Headers,
      invitationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
    rejectInvitation: (
      headers: Headers,
      invitationId: string,
    ) => Effect.Effect<{ success: boolean }, AuthFailure>;
  }
>()("auth/InvitationsService") {}

export const buildInvitationsService = ({ auth, db }: { auth: Auth; db: Db }) =>
  InvitationsService.of({
    inviteMember: (headers, input) =>
      attemptAuth(() =>
        auth.api.createInvitation({
          headers,
          body: {
            ...resolveInvitee(input),
            role: input.role,
            organizationId: input.organizationId,
            resend: input.resend,
            ...(input.teamId ? { teamId: input.teamId } : {}),
          },
        }),
      ).pipe(Effect.map(toInvitation)),

    getInvitation: (headers, id) =>
      attemptAuth(async () => {
        const stored = await db.query.invitation.findFirst({
          where: eq(schema.invitation.id, id),
        });
        if (stored?.nearAccountId) {
          const session = await auth.api.getSession({ headers });
          if (!session?.user) return null;
          const pending = await listPendingNearInvitations(db, session.user.id);
          const match = pending.find((row) => row.invitation.id === id);
          if (!match) return null;
          const inviter = await db.query.user.findFirst({
            where: eq(schema.user.id, match.invitation.inviterId),
          });
          return {
            ...toInvitation(match.invitation),
            organizationName: match.organizationName,
            organizationSlug: match.organizationSlug,
            inviterName: inviter?.name ?? null,
            inviterEmail: null,
          };
        }
        const invitation = await auth.api.getInvitation({
          headers,
          query: { id },
        });
        if (!invitation) return null;
        const inviter = await db.query.user.findFirst({
          where: eq(schema.user.id, invitation.inviterId),
        });
        return {
          ...toInvitation(invitation),
          organizationName: invitation.organizationName,
          organizationSlug: invitation.organizationSlug,
          inviterName: inviter?.name ?? null,
          inviterEmail: null,
        };
      }).pipe(
        Effect.catchIf(
          (error) =>
            error instanceof AuthApiError &&
            (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST"),
          () => Effect.succeed(null),
        ),
      ),

    listInvitations: Effect.fn("InvitationsService.listInvitations")(function* (
      headers: Headers,
      emailContext: EmailVisibilityContext,
      organizationId: string | undefined,
    ) {
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(auth, emailContext, organizationId),
      );
      const result = yield* attemptAuth(() =>
        auth.api.listInvitations({
          headers,
          query: { organizationId },
        }),
      );
      return (result ?? []).map((inv: any) => ({
        ...toInvitation(inv),
        ...(emailAllowed ? { email: inv.email } : { email: null }),
      }));
    }),

    listUserInvitations: Effect.fn("InvitationsService.listUserInvitations")(function* (
      headers: Headers,
      input: { userId: string; emailUnverified: boolean },
    ) {
      const [emailInvitations, walletInvitations] = yield* Effect.all([
        input.emailUnverified
          ? Effect.succeed([])
          : attemptAuth(() => auth.api.listUserInvitations({ headers })),
        Effect.promise(() => listPendingNearInvitations(db, input.userId)),
      ]);
      return [
        ...(emailInvitations ?? []).map((inv: any) => ({
          ...toInvitation(inv),
          ...(inv.organizationName ? { organizationName: inv.organizationName } : {}),
          ...(inv.organizationSlug ? { organizationSlug: inv.organizationSlug } : {}),
        })),
        ...walletInvitations.map((row: any) => ({
          ...toInvitation(row.invitation),
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
        })),
      ];
    }),

    cancelInvitation: (headers, invitationId) =>
      attemptAuth(() => auth.api.cancelInvitation({ headers, body: { invitationId } })).pipe(
        Effect.as({ success: true }),
      ),

    acceptInvitation: (headers, invitationId) =>
      attemptAuth(() => auth.api.acceptInvitation({ headers, body: { invitationId } })).pipe(
        Effect.as({ success: true }),
      ),

    acceptNearInvitation: (headers, invitationId) =>
      attemptAuth(() => auth.api.acceptNearInvitation({ headers, body: { invitationId } })).pipe(
        Effect.as({ success: true }),
      ),

    rejectNearInvitation: (headers, invitationId) =>
      attemptAuth(() => auth.api.rejectNearInvitation({ headers, body: { invitationId } })).pipe(
        Effect.as({ success: true }),
      ),

    rejectInvitation: (headers, invitationId) =>
      attemptAuth(() => auth.api.rejectInvitation({ headers, body: { invitationId } })).pipe(
        Effect.as({ success: true }),
      ),
  });

export const InvitationsServiceLive = Layer.effect(
  InvitationsService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    return buildInvitationsService({ auth, db });
  }),
);

function resolveInvitee(input: { email?: string; nearAccountId?: string; nearNetwork?: string }) {
  if (!!input.email === !!input.nearAccountId) {
    throw new InviteeAmbiguous({ message: "Provide either an email address or a NEAR account id" });
  }
  if (input.email) {
    if (input.nearNetwork !== undefined) {
      throw new NearNetworkOnEmailInvite({
        message: "A NEAR network can only be supplied for wallet invitations",
      });
    }
    return { email: input.email };
  }
  const nearAccountId = normalizeNearAccountId(input.nearAccountId ?? "");
  if (!nearAccountId) {
    throw new InvalidNearAccountId({
      message: `"${input.nearAccountId}" is not a valid NEAR account id`,
    });
  }
  if (!isNearNetwork(input.nearNetwork)) {
    throw new NearNetworkRequired({
      message: "A wallet invitation requires a mainnet or testnet network",
    });
  }
  return {
    email: nearInvitationEmail(nearAccountId, input.nearNetwork),
    nearAccountId,
    nearNetwork: input.nearNetwork,
  };
}
