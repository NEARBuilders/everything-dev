import type { ApiClient } from "@/app";

export type TenantRecord = Awaited<ReturnType<ApiClient["updateTenant"]>>;
export type TenantAction = { isPending: boolean; mutate: () => void };
