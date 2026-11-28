import type { ApiClient } from "everything-dev/ui/api";
import type { RouterContextWithApi } from "everything-dev/ui/types";

export type { ApiClient };

export interface RouterContext extends RouterContextWithApi<ApiClient> {}
