import { loadRemote } from "@module-federation/enhanced/runtime";
import type { ResolvedApp } from "./configs";

/**
 * The composed apiClient — one typed client covering every API plugin's
 * contract. In production this shape is GENERATED from each plugin's oRPC
 * contract (bos types gen); here it's declared inline to prove the injection
 * mechanism: the host builds it, remote UI components receive it via router
 * context, and both base and tenant UIs call `apiClient.dashboard.*`.
 */
export interface DashboardApi {
  getStats: () => Promise<{ users: number; projects: number; revenue: number }>;
  listItems: () => Promise<Array<{ id: number; name: string }>>;
}

export interface ApiClient {
  dashboard: DashboardApi;
}

/**
 * Load every API remote over Module Federation and fold their exports into a
 * single namespaced client. `{ name: "dashboard", ns: "dashboard" }` →
 * `apiClient.dashboard` = the remote's `./api` module.
 */
export async function loadApiClient(config: ResolvedApp): Promise<ApiClient> {
  const client: Record<string, unknown> = {};
  for (const ref of config.api) {
    const mod = (await loadRemote<any>(`${ref.name}/${ref.moduleKey}`)) ?? {};
    const module = mod?.default && mod.default[ref.ns] ? mod.default : mod;
    client[ref.ns] = module;
  }
  return client as unknown as ApiClient;
}
