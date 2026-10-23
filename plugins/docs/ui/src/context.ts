import type { ApiClient } from "everything-dev/ui/api";
import type { RouterContextWithApi } from "everything-dev/ui/types";

export type { ApiClient };

/**
 * Router context the grafted routes run under — structurally the core
 * router's context, provided by the host's core tree at compose time.
 */
export interface RouterContext extends RouterContextWithApi<ApiClient> {}
