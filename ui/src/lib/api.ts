/**
 * oRPC API client binding for this app — binds the generated ApiContract type
 * to the framework client factory. The contract is type-only (generated), so
 * binding is a pure type instantiation.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import type { ContractRouterClient } from "@orpc/contract";
import {
  createApiClient as createFrameworkApiClient,
  useApiClient as useFrameworkApiClient,
  useOrpc as useFrameworkUseOrpc,
} from "everything-dev/ui/api";
import type { ApiContract } from "./api-types.gen";

export type { ApiContract };
export type ApiClient = ContractRouterClient<ApiContract>;

export const createApiClient = createFrameworkApiClient<ApiContract>;

export const useApiClient = useFrameworkApiClient<ApiContract>;

export const useOrpc = useFrameworkUseOrpc<ApiContract>;
