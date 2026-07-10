import type {
  AuthPluginContext,
  AuthRequestContext,
  AuthSession,
  AuthSessionData,
  AuthSessionUser,
} from "@/lib/auth-types.gen";

export type {
  AuthPluginContext,
  AuthRequestContext,
  AuthSession,
  AuthSessionData,
  AuthSessionUser,
};
export type AuthUser = AuthSessionUser;

export type { AuthServices } from "@/lib/auth-types.gen";

export interface AuthClient {
  getSession(): Promise<AuthSession | null>;
  getContext(): Promise<AuthRequestContext>;
}

export interface AuthVariables {
  authContext: AuthRequestContext | null;
  user: AuthUser | null;
  session: AuthSessionData | null;
  reqHeaders: Headers;
  getRawBody: () => Promise<string>;
}
