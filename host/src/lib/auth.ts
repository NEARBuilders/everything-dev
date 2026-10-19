import type { AuthRequestContext, AuthSession, AuthSessionUser } from "@/lib/auth-types.gen";

export type * from "@/lib/auth-types.gen";

export type AuthUser = AuthSessionUser;

/** Session row carried by the once-per-request `getContext` resolution. */
export type AuthContextSession = NonNullable<AuthRequestContext["session"]>;

export interface AuthClient {
  getSession(): Promise<AuthSession | null>;
  getContext(): Promise<AuthRequestContext>;
}

export interface AuthVariables {
  authContext: AuthRequestContext | null;
  user: AuthUser | null;
  session: AuthContextSession | null;
  reqHeaders: Headers;
  getRawBody: () => Promise<string>;
}

export type HonoEnv = { Variables: AuthVariables };

export function toAuthClientContext(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}
