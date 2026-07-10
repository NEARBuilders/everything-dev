import type {
  AuthPluginContext,
  AuthRequestContext,
  AuthSession,
  AuthSessionData,
  AuthSessionUser,
  AuthServices as GeneratedAuthServices,
} from "@/lib/auth-types.gen";

export type {
  AuthPluginContext,
  AuthRequestContext,
  AuthSession,
  AuthSessionData,
  AuthSessionUser,
};
export type AuthUser = AuthSessionUser;

type AuthServices = GeneratedAuthServices;

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

export type HonoEnv = { Variables: AuthVariables };

export function toAuthClientContext(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

export type { AuthServices };
