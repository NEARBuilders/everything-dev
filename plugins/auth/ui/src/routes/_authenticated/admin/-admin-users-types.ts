import type { AuthApiClient } from "@/lib/api";

export type AdminUser = Awaited<ReturnType<AuthApiClient["adminListUsers"]>>["users"][number];

export type AdminSession = Awaited<
  ReturnType<AuthApiClient["adminListUserSessions"]>
>["sessions"][number];
