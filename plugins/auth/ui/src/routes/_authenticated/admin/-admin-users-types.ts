import type { ContractRouterClient } from "@orpc/contract";
import type { ContractType } from "../../../src/contract";

export type AuthApiClient = ContractRouterClient<ContractType>;

export type AdminUser = Awaited<ReturnType<AuthApiClient["adminListUsers"]>>["users"][number];

export type AdminSession = Awaited<
  ReturnType<AuthApiClient["adminListUserSessions"]>
>["sessions"][number];
