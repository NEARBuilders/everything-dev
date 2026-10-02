import type { ClientRuntimeConfig } from "@/app";
import { getAppName } from "@/app";

export function pageTitle(
  label: string,
  runtimeConfig?: Partial<ClientRuntimeConfig> | null,
): string {
  const appName = getAppName(runtimeConfig ?? undefined) || "everything.dev";
  return label ? `${label} · ${appName}` : appName;
}
