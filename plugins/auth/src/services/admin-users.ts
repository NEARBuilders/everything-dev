import { Context, Effect, Layer } from "effect";
import { attemptAuth } from "../attempts";
import type { InferInput, InferOutput } from "../contract";
import { toAdminSession, toAdminUser } from "../serializers";
import { AuthApiTag, type PluginServices } from "../service-types";
import type { AuthFailure } from "./domain-errors";

type Auth = PluginServices["auth"];

type AdminRole = InferInput<"adminSetRole">["role"];
type AdminListUsersInput = NonNullable<InferInput<"adminListUsers">>;
type AdminBanInput = InferInput<"adminBanUser">;

export class AdminUsersService extends Context.Service<
  AdminUsersService,
  {
    listUsers: (
      headers: Headers,
      input: AdminListUsersInput,
    ) => Effect.Effect<InferOutput<"adminListUsers">, AuthFailure>;
    getUser: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<InferOutput<"adminGetUser">, AuthFailure>;
    setRole: (
      headers: Headers,
      userId: string,
      role: AdminRole,
    ) => Effect.Effect<InferOutput<"adminSetRole">, AuthFailure>;
    banUser: (
      headers: Headers,
      input: AdminBanInput,
    ) => Effect.Effect<InferOutput<"adminBanUser">, AuthFailure>;
    unbanUser: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<InferOutput<"adminUnbanUser">, AuthFailure>;
    listUserSessions: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<InferOutput<"adminListUserSessions">, AuthFailure>;
    revokeUserSession: (
      headers: Headers,
      sessionToken: string,
    ) => Effect.Effect<InferOutput<"adminRevokeUserSession">, AuthFailure>;
    revokeUserSessions: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<InferOutput<"adminRevokeUserSessions">, AuthFailure>;
    setUserPassword: (
      headers: Headers,
      userId: string,
      newPassword: string,
    ) => Effect.Effect<InferOutput<"adminSetUserPassword">, AuthFailure>;
    removeUser: (
      headers: Headers,
      userId: string,
    ) => Effect.Effect<InferOutput<"adminRemoveUser">, AuthFailure>;
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
        Effect.as({ success: true }),
      ),

    revokeUserSessions: (headers, userId) =>
      attemptAuth(() => auth.api.revokeUserSessions({ headers, body: { userId } })).pipe(
        Effect.as({ success: true }),
      ),

    setUserPassword: (headers, userId, newPassword) =>
      attemptAuth(() => auth.api.setUserPassword({ headers, body: { userId, newPassword } })).pipe(
        Effect.map((result) => ({ status: result.status })),
      ),

    removeUser: (headers, userId) =>
      attemptAuth(() => auth.api.removeUser({ headers, body: { userId } })).pipe(
        Effect.as({ success: true }),
      ),
  });

export const AdminUsersServiceLive = Layer.effect(
  AdminUsersService,
  Effect.gen(function* () {
    const { auth } = yield* AuthApiTag;
    return buildAdminUsersService({ auth });
  }),
);
