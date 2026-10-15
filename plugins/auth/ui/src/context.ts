import type { ApiClient } from "everything-dev/ui/api";
import type { AuthClient, SessionData } from "everything-dev/ui/auth";
import type { RouterContextWithApi } from "everything-dev/ui/types";
import type { AuthApiClient } from "@/lib/api";

export type { ApiClient, AuthClient, SessionData };

/**
 * Router context the grafted routes run under — structurally the core
 * router's context, provided by the host's core tree at compose time. The
 * host's merged client carries this plugin's routes under `auth`.
 */
export interface RouterContext
  extends RouterContextWithApi<ApiClient & { auth: AuthApiClient }, SessionData> {
  apiClient: ApiClient & { auth: AuthApiClient };
  authClient: AuthClient;
}
