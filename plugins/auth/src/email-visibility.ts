import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import {
  canReadMemberEmails,
  type EmailVisibilityContext,
  type OrgPermissionAuth,
  visibleEmail,
} from "./utils";

interface JsonReturned {
  body: unknown;
  routerResponse?: Response;
  _flag: string;
}

function asJsonReturned(value: unknown): JsonReturned | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate._flag !== "json" || !("body" in candidate)) return null;
  return {
    body: candidate.body,
    routerResponse: candidate.routerResponse as Response | undefined,
    _flag: "json",
  };
}

function redactMemberEmail(member: unknown, emailAllowed: boolean, selfId: string): unknown {
  if (typeof member !== "object" || member === null) return member;
  const source = member as Record<string, unknown>;
  const user = source.user;
  if (typeof user !== "object" || user === null) return member;
  const userRecord = user as Record<string, unknown>;
  return {
    ...source,
    user: {
      ...userRecord,
      email: visibleEmail(typeof userRecord.email === "string" ? userRecord.email : null, {
        allowed: emailAllowed,
        isSelf: source.userId === selfId,
      }),
    },
  };
}

function redactInvitationEmail(invitation: unknown, emailAllowed: boolean): unknown {
  if (typeof invitation !== "object" || invitation === null) return invitation;
  const source = invitation as Record<string, unknown>;
  return {
    ...source,
    email: emailAllowed ? source.email : null,
  };
}

function redactFullOrganization(payload: unknown, emailAllowed: boolean, selfId: string): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const source = payload as Record<string, unknown>;
  return {
    ...source,
    members: Array.isArray(source.members)
      ? source.members.map((member) => redactMemberEmail(member, emailAllowed, selfId))
      : source.members,
    invitations: Array.isArray(source.invitations)
      ? source.invitations.map((invitation) => redactInvitationEmail(invitation, emailAllowed))
      : source.invitations,
  };
}

export function emailVisibility(options: { getAuth: () => OrgPermissionAuth | undefined }) {
  return {
    id: "email-visibility",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/organization/list-members",
          handler: createAuthMiddleware(async (ctx) => {
            if (!ctx.request) return;
            throw new APIError("FORBIDDEN", {
              message:
                "Use POST /api/rpc/auth/listMembers — member emails are permission-filtered there",
            });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/organization/get-full-organization",
          handler: createAuthMiddleware(async (ctx) => {
            if (!ctx.request) return;
            const auth = options.getAuth();
            const session = await getSessionFromCtx(ctx);
            if (!auth || !session?.user) return;
            const wrapped = asJsonReturned(ctx.context.returned);
            const payload = wrapped ? wrapped.body : ctx.context.returned;
            if (typeof payload !== "object" || payload === null) return;
            const organizationId = (payload as { id?: unknown }).id;
            if (typeof organizationId !== "string") return;
            const emailVisibilityContext: EmailVisibilityContext = {
              user: { id: session.user.id, role: session.user.role },
              userId: session.user.id,
              reqHeaders: ctx.headers instanceof Headers ? ctx.headers : undefined,
            };
            const emailAllowed = await canReadMemberEmails(
              auth,
              emailVisibilityContext,
              organizationId,
            );
            const redacted = redactFullOrganization(payload, emailAllowed, session.user.id);
            return wrapped ? { ...wrapped, body: redacted } : redacted;
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
