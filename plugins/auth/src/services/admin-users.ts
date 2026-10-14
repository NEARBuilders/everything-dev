import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { attemptAuth } from "../attempts";
import { toAdminSession, toAdminUser } from "../serializers";
import { AuthApiTag, type PluginServices } from "../service-types";

type Auth = PluginServices["auth"];

type AdminRoleInput =
  NonNullable<Parameters<Auth["api"]["setRole"]>[0]> extends {
    body: { role: infer R };
  }
    ? R
    : never;

export class AdminUsersService extends Context.Service<
  AdminUsersService,
  {
    listUsers: (
      headers: Headers,
      input: {
        searchValue?: string;
        searchField?: "email" | "name";
        limit?: number;
        offset?: number;
      },
    ) => Effect.Effect<{ users: any[]; total: number }, ORPCError<string, unknown>>;
    getUser: (headers: Headers, userId: string) => Effect.Effect<any, ORPCError<string, unknown>>;
    setRole: (headers: Headers, userId: string, role: AdminRoleInput) => Effect.Effect<any, ORPCError<string, unknown>>;
    banUser: (
      headers: Headers,
      input: { userId: string; banReason?: string; banExpiresIn?: number },
    ) => Effect.Effect<any, ORPCError<string, unknown>>;
    unbanUser: (headers: Headers, userId: string) => Effect.Effect<any, ORPCError<string, unknown>>;
    listUserSessions: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<{ sessions: any[] }, ORPCError<string, unknown>>;
    revokeUserSession: (
      headers: Headers,
      sessionToken: string,
    ) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
    revokeUserSessions: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
    setUserPassword: (
      headers: Headers,
      userId: string,
      newPassword: string,
    ) => Effect.Effect<{ status: boolean }, ORPCError<string, unknown>>;
    removeUser: (headers: Headers, userId: string) => Effect.Effect<{ success: boolean }, ORPCError<string, unknown>>;
  }
>()("auth/AdminUsersService") {}

export const buildAdminUsersService = ({ auth }: { auth: Auth }) =>
  AdminUsersService.of({
    listUsers: (headers, input) =>
      attemptAuth(() =>
        auth.api.listUsers({
          headers,
          query: {
            ...(input.searchValue ? { searchValue: input.searchValue } : {}),
            ...(input.searchField ? { searchField: input.searchField } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            ...(input.offset !== undefined ? { offset: input.offset } : {}),
          },
        }),
      ).pipe(
        Effect.map((result) => ({
          users: (result?.users ?? []).map(toAdminUser),
          total: result?.total ?? 0,
        })),
      ),

    getUser: (headers, userId) =>
      attemptAuth(() => auth.api.getUser({ headers, query: { id: userId } })).pipe(
        Effect.map(toAdminUser),
      ),

    setRole: (headers, userId, role) =>
      attemptAuth(() => auth.api.setRole({ headers, body: { userId, role } })).pipe(
        Effect.map((result) => toAdminUser(result.user)),
      ),

    banUser: (headers, input) =>
      attemptAuth(() =>
        auth.api.banUser({
          headers,
          body: {
            userId: input.userId,
            ...(input.banReason !== undefined ? { banReason: input.banReason } : {}),
            ...(input.banExpiresIn !== undefined ? { banExpiresIn: input.banExpiresIn } : {}),
          },
        }),
      ).pipe(Effect.map((result) => toAdminUser(result.user))),

    unbanUser: (headers, userId) =>
      attemptAuth(() => auth.api.unbanUser({ headers, body: { userId } })).pipe(
        Effect.map((result) => toAdminUser(result.user)),
      ),

    listUserSessions: (headers, userId) =>
      attemptAuth(() => auth.api.listUserSessions({ headers, body: { userId } })).pipe(
        Effect.map((result) => ({
          sessions: (result?.sessions ?? []).map(toAdminSession),
        })),
      ),

    revokeUserSession: (headers, sessionToken) =>
      attemptAuth(() => auth.api.revokeUserSession({ headers, body: { sessionToken } })).pipe(
        Effect.map(() => ({ success: true })),
      ),

    revokeUserSessions: (headers, userId) =>
      attemptAuth(() => auth.api.revokeUserSessions({ headers, body: { userId } })).pipe(
        Effect.map(() => ({ success: true })),
      ),

    setUserPassword: (headers, userId, newPassword) =>
      attemptAuth(() => auth.api.setUserPassword({ headers, body: { userId, newPassword } })).pipe(
        Effect.map((result) => ({ status: result.status })),
      ),

    removeUser: (headers, userId) =>
      attemptAuth(() => auth.api.removeUser({ headers, body: { userId } })).pipe(
        Effect.map(() => ({ success: true })),
      ),
  });

export const AdminUsersServiceLive = Layer.effect(
  AdminUsersService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    return buildAdminUsersService({ auth });
  }),
);
