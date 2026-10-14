import type { Implementer } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { AuthErrors, ContractType } from "../contract";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import type { AuthHandlerContext, RequireAuthMiddleware } from "../middleware";
import {
  isNearNetwork,
  listPendingNearInvitations,
  nearInvitationEmail,
  normalizeNearAccountId,
} from "../near-invitations";
import { AuthApiTag, type PluginServices } from "../service-types";
import { canReadMemberEmails, createHeaders, toORPCError } from "../utils";
import { attemptAuth, attemptDb } from "./attempts";

function resolveInvitee(
  input: { email?: string; nearAccountId?: string; nearNetwork?: string },
  errors: AuthErrors,
) {
  if (!!input.email === !!input.nearAccountId) {
    throw errors.BAD_REQUEST({
      message: "Provide either an email address or a NEAR account id",
      data: {},
    });
  }
  if (input.email) {
    if (input.nearNetwork !== undefined) {
      throw errors.BAD_REQUEST({
        message: "A NEAR network can only be supplied for wallet invitations",
        data: {},
      });
    }
    return { email: input.email };
  }
  const nearAccountId = normalizeNearAccountId(input.nearAccountId ?? "");
  if (!nearAccountId) {
    throw errors.BAD_REQUEST({
      message: `"${input.nearAccountId}" is not a valid NEAR account id`,
      data: {},
    });
  }
  if (!isNearNetwork(input.nearNetwork)) {
    throw errors.BAD_REQUEST({
      message: "A wallet invitation requires a mainnet or testnet network",
      data: {},
    });
  }
  return {
    email: nearInvitationEmail(nearAccountId, input.nearNetwork),
    nearAccountId,
    nearNetwork: input.nearNetwork,
  };
}

function toInvitation(invitation: any) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt:
      invitation.expiresAt instanceof Date ? invitation.expiresAt : new Date(invitation.expiresAt),
    inviterId: invitation.inviterId,
    teamId: invitation.teamId ?? null,
    nearAccountId: invitation.nearAccountId ?? null,
    nearNetwork: invitation.nearNetwork ?? null,
  };
}

async function getInvitationOrNull(
  auth: PluginServices["auth"],
  db: PluginServices["db"],
  headers: Headers,
  id: string,
) {
  try {
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
  } catch (error) {
    const mapped = toORPCError(error);
    if (mapped.code === "NOT_FOUND" || mapped.code === "BAD_REQUEST") return null;
    throw mapped;
  }
}

export function createInvitationHandlers(
  builder: Implementer<ContractType, AuthHandlerContext>,
  requireAuth: RequireAuthMiddleware,
) {
  return {
    inviteMember: builder.inviteMember.use(requireAuth).effect(function* ({
      input,
      context,
      errors,
    }) {
      const { auth } = yield* AuthApiTag;
      const result = yield* attemptAuth(() =>
        auth.api.createInvitation({
          headers: createHeaders(context.reqHeaders),
          body: {
            ...resolveInvitee(input, errors),
            role: input.role,
            organizationId: input.organizationId,
            resend: input.resend,
            ...(input.teamId ? { teamId: input.teamId } : {}),
          },
        }),
      );
      return toInvitation(result);
    }),

    getInvitation: builder.getInvitation.effect(function* ({ input, context }) {
      const { auth } = yield* AuthApiTag;
      const db = yield* DatabaseTag;
      const headers = createHeaders(context.reqHeaders ?? {});
      return yield* attemptDb(() => getInvitationOrNull(auth, db, headers, input.id));
    }),

    listInvitations: builder.listInvitations.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      const emailAllowed = yield* Effect.promise(() =>
        canReadMemberEmails(auth, context, input?.organizationId),
      );
      const result = yield* attemptAuth(() =>
        auth.api.listInvitations({
          headers: createHeaders(context.reqHeaders),
          query: {
            organizationId: input.organizationId,
          },
        }),
      );
      return (result ?? []).map((inv: any) => ({
        ...toInvitation(inv),
        ...(emailAllowed ? { email: inv.email } : { email: null }),
      }));
    }),

    listUserInvitations: builder.listUserInvitations.use(requireAuth).effect(function* ({
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      const db = yield* DatabaseTag;
      const [emailInvitations, walletInvitations] = yield* Effect.all([
        context.user?.emailVerified === false
          ? Effect.succeed([])
          : attemptAuth(() =>
              auth.api.listUserInvitations({
                headers: createHeaders(context.reqHeaders),
              }),
            ),
        Effect.promise(() => listPendingNearInvitations(db, context.userId)),
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

    cancelInvitation: builder.cancelInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.cancelInvitation({
          headers: createHeaders(context.reqHeaders),
          body: { invitationId: input.invitationId },
        }),
      );
      return { success: true };
    }),

    acceptInvitation: builder.acceptInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.acceptInvitation({
          headers: createHeaders(context.reqHeaders),
          body: { invitationId: input.invitationId },
        }),
      );
      return { success: true };
    }),

    acceptNearInvitation: builder.acceptNearInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.acceptNearInvitation({
          headers: createHeaders(context.reqHeaders),
          body: { invitationId: input.invitationId },
        }),
      );
      return { success: true };
    }),

    rejectNearInvitation: builder.rejectNearInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.rejectNearInvitation({
          headers: createHeaders(context.reqHeaders),
          body: { invitationId: input.invitationId },
        }),
      );
      return { success: true };
    }),

    rejectInvitation: builder.rejectInvitation.use(requireAuth).effect(function* ({
      input,
      context,
    }) {
      const { auth } = yield* AuthApiTag;
      yield* attemptAuth(() =>
        auth.api.rejectInvitation({
          headers: createHeaders(context.reqHeaders),
          body: { invitationId: input.invitationId },
        }),
      );
      return { success: true };
    }),
  };
}
