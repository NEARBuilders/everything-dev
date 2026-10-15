/**
 * The plugin ui's api-client seam — mirrors the core ui's lib/api.ts: the
 * auth contract (its own server source, workspace-local whenever this ui is
 * local) binds once here, so routes import the typed client from @/lib/api
 * instead of walking into server sources.
 */

import type { ContractRouterClient } from "@orpc/contract";
import type { ContractType } from "../../../src/contract";

export type AuthApiClient = ContractRouterClient<ContractType>;
