import type { ApiClient } from "everything-dev/ui/api";
import type { AuthClient, SessionData } from "everything-dev/ui/auth";
import type { RouterContextWithApi } from "everything-dev/ui/types";

export type { ApiClient, AuthClient, SessionData };

/**
 * Router context the grafted routes run under — structurally the core
 * router's context, provided by the host's core tree at compose time.
 */
export interface RouterContext extends RouterContextWithApi<ApiClient, SessionData> {
  apiClient: ApiClient;
  authClient: AuthClient;
}
