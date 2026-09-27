import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Context } from "effect";
import * as schema from "../db/schema";
import {
  isNearNetwork,
  listPendingNearInvitations,
  nearInvitationEmail,
  normalizeNearAccountId,
} from "../near-invitations";
import { AuthServicesTag } from "../service-types";
import { createHeaders, safeAuthApi } from "../utils";

function resolveInvitee(input: { email?: string; nearAccountId?: string; nearNetwork?: string }) {
  if (!!input.email === !!input.nearAccountId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Provide either an email address or a NEAR account id",
    });
  }
  if (input.email) {
    if (input.nearNetwork !== undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A NEAR network can only be supplied for wallet invitations",
      });
    }
    return { email: input.email };
  }
  const nearAccountId = normalizeNearAccountId(input.nearAccountId ?? "");
  if (!nearAccountId) {
    throw new ORPCError("BAD_REQUEST", {
      message: `"${input.nearAccountId}" is not a valid NEAR account id`,
    });
  }
  if (!isNearNetwork(input.nearNetwork)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A wallet invitation requires a mainnet or testnet network",
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

export function createInvitationHandlers(builder: any, requireAuth: any) {
  return {
    inviteMember: builder.inviteMember
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.createInvitation({
            headers: createHeaders(context.reqHeaders),
            body: {
              ...resolveInvitee(input),
              role: input.role,
              organizationId: input.organizationId,
              resend: input.resend,
              ...(input.teamId ? { teamId: input.teamId } : {}),
            },
          }),
        );
        return toInvitation(result);
      }),

    getInvitation: builder.getInvitation.handler(
      async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const headers = createHeaders(context.reqHeaders ?? {});
        try {
          const stored = await services.db.query.invitation.findFirst({
            where: eq(schema.invitation.id, input.id),
          });
          if (stored?.nearAccountId) {
            const session = await services.auth.api.getSession({ headers });
            if (!session?.user) return null;
            const pending = await listPendingNearInvitations(services.db, session.user.id);
            const match = pending.find((row) => row.invitation.id === input.id);
            if (!match) return null;
            const inviter = await services.db.query.user.findFirst({
              where: eq(schema.user.id, match.invitation.inviterId),
            });
            return {
              ...toInvitation(match.invitation),
              organizationName: match.organizationName,
              organizationSlug: match.organizationSlug,
              inviterEmail: inviter?.email ?? "",
            };
          }
          const invitation = await services.auth.api.getInvitation({
            headers,
            query: { id: input.id },
          });
          if (!invitation) return null;
          return {
            ...toInvitation(invitation),
            organizationName: invitation.organizationName,
            organizationSlug: invitation.organizationSlug,
            inviterEmail: invitation.inviterEmail,
          };
        } catch {
          return null;
        }
      },
    ),

    listInvitations: builder.listInvitations
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const result = await safeAuthApi(() =>
          services.auth.api.listInvitations({
            headers: createHeaders(context.reqHeaders),
            query: {
              organizationId: input.organizationId,
            },
          }),
        );
        return (result ?? []).map(toInvitation);
      }),

    listUserInvitations: builder.listUserInvitations
      .use(requireAuth)
      .handler(async ({ context }: { context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        const [emailInvitations, walletInvitations] = await Promise.all([
          context.user?.emailVerified === false
            ? Promise.resolve([])
            : safeAuthApi(() =>
                services.auth.api.listUserInvitations({
                  headers: createHeaders(context.reqHeaders),
                }),
              ),
          listPendingNearInvitations(services.db, context.userId),
        ]);
        return [
          ...(emailInvitations ?? []).map((inv: any) => ({
            ...toInvitation(inv),
            ...(inv.organizationName ? { organizationName: inv.organizationName } : {}),
            ...(inv.organizationSlug ? { organizationSlug: inv.organizationSlug } : {}),
          })),
          ...walletInvitations.map((row) => ({
            ...toInvitation(row.invitation),
            organizationName: row.organizationName,
            organizationSlug: row.organizationSlug,
          })),
        ];
      }),

    cancelInvitation: builder.cancelInvitation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.cancelInvitation({
            headers: createHeaders(context.reqHeaders),
            body: { invitationId: input.invitationId },
          }),
        );
        return { success: true };
      }),

    acceptInvitation: builder.acceptInvitation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.acceptInvitation({
            headers: createHeaders(context.reqHeaders),
            body: { invitationId: input.invitationId },
          }),
        );
        return { success: true };
      }),

    acceptNearInvitation: builder.acceptNearInvitation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.acceptNearInvitation({
            headers: createHeaders(context.reqHeaders),
            body: { invitationId: input.invitationId },
          }),
        );
        return { success: true };
      }),

    rejectNearInvitation: builder.rejectNearInvitation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.rejectNearInvitation({
            headers: createHeaders(context.reqHeaders),
            body: { invitationId: input.invitationId },
          }),
        );
        return { success: true };
      }),

    rejectInvitation: builder.rejectInvitation
      .use(requireAuth)
      .handler(async ({ input, context }: { input: any; context: any }) => {
        const services = Context.get(context["effect/context"], AuthServicesTag);
        await safeAuthApi(() =>
          services.auth.api.rejectInvitation({
            headers: createHeaders(context.reqHeaders),
            body: { invitationId: input.invitationId },
          }),
        );
        return { success: true };
      }),
  };
}
