/**
 * Better-Auth client surface for this app — re-exports the framework auth
 * client factory (plugin inference is preserved there; no app-specific
 * additional fields exist to bind).
 */

export type {
  AuthClient,
  AuthContext,
  CreateAuthClientOptions,
  Organization,
  Passkey,
  SessionData,
} from "everything-dev/ui/auth";

export {
  clearAuthenticatedQueries,
  createAuthClient,
  pluginHref,
  pluginPath,
  pluginSearch,
  refreshSessionCache,
  requireAdmin,
  requireSession,
  resolveSessionFromCache,
  sessionQueryKey,
  sessionQueryOptions,
  useAuthClient,
  useRelayHistory,
} from "everything-dev/ui/auth";
export type * from "./auth-types.gen";
