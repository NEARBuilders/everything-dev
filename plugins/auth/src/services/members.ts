import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { attemptAuth, attemptDb } from "../attempts";
import { DatabaseTag } from "../db/layer";
import * as schema from "../db/schema";
import { AuthApiTag, type PluginServices } from "../service-types";
import {
  canReadMemberEmails,
  type EmailVisibilityContext,
  hasOrgPermission,
  parseMemberRoles,
  visibleEmail,
} from "../utils";

type Auth = PluginServices["auth"];
type Db = PluginServices["db"];

export class MembersService extends Context.Service<
  MembersService,
  {
    exportMembers: (
      headers: Headers,
      context: EmailVisibilityContext,
      organizationId: string | undefined,
    ) => Effect.Effect<{ csv: string }, ORPCError<string, unknown>>;
    getActiveMember: (
      headers: Headers,
      organizationId: string | undefined,
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    getActiveMemberRole: (
      headers: Headers,
      organizationId: string | undefined,
    ) => Effect.Effect<{ role: string | null }, ORPCError<string, unknown>>;
    listMembers: (
      headers: Headers,
      context: EmailVisibilityContext,
      input: { organizationId?: string; limit?: number; offset?: number },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    addMember: (
      headers: Headers,
      context: EmailVisibilityContext & { userId: string },
      input: {
        userId: string;
        role: "owner" | "admin" | "member";
        organizationId?: string;
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    removeMember: (
      headers: Headers,
      input: { memberIdOrEmail: string; organizationId?: string },
    ) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
    updateMemberRole: (
      headers: Headers,
      context: EmailVisibilityContext,
      input: {
        role: string;
        memberId: string;
        organizationId?: string;
      },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
  }
>()("auth/MembersService") {}

export const buildMembersService = ({ auth, db }: { auth: Auth; db: Db }) =>
  MembersService.of({
    exportMembers: Effect.fn("MembersService.exportMembers")(
      function* (headers: Headers, context: EmailVisibilityContext, organizationId: string | undefined) {
        const emailAllowed = yield* Effect.promise(() =>
          canReadMemberEmails(auth, context, organizationId),
        );
        if (!emailAllowed) {
          return yield* Effect.fail(
            new ORPCError("FORBIDDEN", {
              message: "You do not have permission to export member emails",
              data: {},
            }),
          );
        }
        const result = yield* attemptAuth(() =>
          auth.api.listMembers({
            headers,
            query: { organizationId, limit: 1000 },
          }),
        );
        const rows = [
          "name,email,role",
          ...(result.members ?? []).map((m: any) => {
            const name = (m.user?.name ?? "").replace(/[\r\n,]/g, " ").trim();
            const email = m.user?.email ?? "";
            const safe = String(email).replace(/[\r\n]/g, "");
            return `${name},${safe},${m.role}`;
          }),
        ];
        return { csv: rows.join("\n") };
      },
    ),

    getActiveMember: (headers, organizationId) =>
      attemptAuth(() =>
        auth.api.getActiveMember({
          headers,
          query: organizationId ? { organizationId } : undefined,
        }),
      ).pipe(
        Effect.map((member) =>
          member
            ? {
                id: member.id,
                role: member.role,
                organizationId: member.organizationId ?? null,
              }
            : { id: null, role: null, organizationId: null },
        ),
      ),

    getActiveMemberRole: (headers, organizationId) =>
      attemptAuth(() =>
        auth.api.getActiveMemberRole({
          headers,
          query: organizationId ? { organizationId } : undefined,
        }),
      ).pipe(
        Effect.map((result) => ({
          role: typeof result === "string" ? result : ((result as any)?.role ?? null),
        })),
      ),

    listMembers: Effect.fn("MembersService.listMembers")(
      function* (
        headers: Headers,
        context: EmailVisibilityContext,
        input: { organizationId?: string; limit?: number; offset?: number },
      ) {
        const result = yield* attemptAuth(() =>
          auth.api.listMembers({
            headers,
            query: {
              organizationId: input.organizationId,
              limit: input.limit,
              offset: input.offset,
            },
          }),
        );
        const emailAllowed = yield* Effect.promise(() =>
          canReadMemberEmails(auth, context, input?.organizationId),
        );
        const selfId = context.userId ?? context.user?.id;
        return {
          members: (result.members ?? []).map((m: any) => ({
            id: m.id,
            userId: m.userId,
            organizationId: m.organizationId,
            role: m.role,
            createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
            user: m.user
              ? {
                  id: m.user.id,
                  name: m.user.name,
                  email: visibleEmail(m.user.email, {
                    allowed: emailAllowed,
                    isSelf: m.userId === selfId,
                  }),
                  image: m.user.image,
                }
              : null,
          })),
          total: result.total,
        };
      },
    ),

    addMember: Effect.fn("MembersService.addMember")(
      function* (
        headers: Headers,
        context: EmailVisibilityContext & { userId: string },
        input: { userId: string; role: "owner" | "admin" | "member"; organizationId?: string },
      ) {
        const session = input.organizationId
          ? null
          : yield* attemptAuth(() => auth.api.getSession({ headers }));
        const activeSession = session
          ? yield* attemptDb(() =>
              db.query.session.findFirst({
                where: eq(schema.session.id, session.session.id),
              }),
            )
          : null;
        const organizationId = input.organizationId ?? activeSession?.activeOrganizationId;
        if (!organizationId) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "No active organization", data: {} }),
          );
        }
        if (context.user?.role !== "admin") {
          const { permitted, failure } = yield* Effect.promise(() =>
            hasOrgPermission(auth, context, organizationId, { member: ["create"] }),
          );
          if (
            failure &&
            (failure.code === "INTERNAL_SERVER_ERROR" || failure.code === "SERVICE_UNAVAILABLE")
          ) {
            return yield* Effect.fail(failure);
          }
          if (!permitted) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message: "Only organization owners and admins can add members",
                data: { requiredPermissions: ["member:create"] },
              }),
            );
          }
          if (input.role === "owner") {
            const caller = yield* attemptDb(() =>
              db.query.member.findFirst({
                where: and(
                  eq(schema.member.organizationId, organizationId),
                  eq(schema.member.userId, context.userId),
                ),
              }),
            );
            if (!parseMemberRoles(caller?.role).includes("owner")) {
              return yield* Effect.fail(
                new ORPCError("FORBIDDEN", {
                  message: "Only organization owners can add owners",
                  data: { action: "add-owner" },
                }),
              );
            }
          }
        }
        const organization = yield* attemptDb(() =>
          db.query.organization.findFirst({
            where: eq(schema.organization.id, organizationId),
          }),
        );
        if (!organization) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: "Organization not found",
              data: { resource: "organization", resourceId: organizationId },
            }),
          );
        }
        if (organization.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("FORBIDDEN", {
              message: "Organization approval is required",
              data: { action: "add-member" },
            }),
          );
        }
        const result = yield* attemptAuth(() =>
          auth.api.addMember({
            headers,
            body: {
              userId: input.userId,
              role: input.role,
              organizationId,
            },
          }),
        );
        return {
          id: result.id,
          userId: result.userId,
          organizationId: result.organizationId,
          role: result.role,
          createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
        };
      },
    ),

    removeMember: (headers, input) =>
      attemptAuth(() =>
        auth.api.removeMember({
          headers,
          body: {
            memberIdOrEmail: input.memberIdOrEmail,
            organizationId: input.organizationId,
          },
        }),
      ).pipe(Effect.as({ success: true })),

    updateMemberRole: Effect.fn("MembersService.updateMemberRole")(
      function* (
        headers: Headers,
        context: EmailVisibilityContext,
        input: { role: string; memberId: string; organizationId?: string },
      ) {
        const emailAllowed = yield* Effect.promise(() =>
          canReadMemberEmails(auth, context, input.organizationId),
        );
        const result = yield* attemptAuth(() =>
          auth.api.updateMemberRole({
            headers,
            body: {
              role: input.role,
              memberId: input.memberId,
              organizationId: input.organizationId,
            },
          }),
        );
        const selfId = context.userId ?? context.user?.id;
        return {
          id: result.id,
          userId: result.userId,
          organizationId: result.organizationId,
          role: result.role,
          createdAt: result.createdAt instanceof Date ? result.createdAt : new Date(result.createdAt),
          user: result.user
            ? {
                id: result.user.id,
                name: result.user.name,
                email: visibleEmail(result.user.email, {
                  allowed: emailAllowed,
                  isSelf: result.userId === selfId,
                }),
                image: result.user.image ?? null,
              }
            : null,
        };
      },
    ),
  });

export const MembersServiceLive = Layer.effect(
  MembersService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    const db = yield* DatabaseTag;
    return buildMembersService({ auth, db });
  }),
);
