import type { RouterContext } from "@/context";
import {
  fillOrganizationId,
  type OnboardCommunity,
  type OnboardConfig,
  type OnboardLink,
  onboardCommunitySchema,
  onboardConfigSchema,
} from "../../../src/onboard-config";

export type { OnboardCommunity, OnboardLink };

export const DEFAULT_ONBOARD_LINKS = {
  next: { href: "/build", label: "Get build prompts" },
  home: { href: "/dashboard", label: "Go to Home" },
  explore: { href: "/explore", label: "Explore communities" },
} as const;

export function readOnboardConfig(runtimeConfig: RouterContext["runtimeConfig"]): OnboardConfig {
  const parsed = onboardConfigSchema.safeParse(runtimeConfig?.auth?.variables?.onboard);
  return parsed.success ? parsed.data : {};
}

export function resolveOnboardLinks(config: OnboardConfig, organizationId?: string) {
  const fill = (link: OnboardLink, fallbackLabel: string) => ({
    href: organizationId ? fillOrganizationId(link.href, organizationId) : link.href,
    label: link.label ?? fallbackLabel,
  });
  const next = config.links?.next;
  return {
    next:
      next === false
        ? null
        : fill(next ?? DEFAULT_ONBOARD_LINKS.next, DEFAULT_ONBOARD_LINKS.next.label),
    home: fill(config.links?.home ?? DEFAULT_ONBOARD_LINKS.home, DEFAULT_ONBOARD_LINKS.home.label),
    explore: fill(
      config.links?.explore ?? DEFAULT_ONBOARD_LINKS.explore,
      DEFAULT_ONBOARD_LINKS.explore.label,
    ),
  };
}

export async function fetchOnboardCommunity(
  urlTemplate: string,
  organizationId: string,
): Promise<OnboardCommunity | null> {
  const response = await fetch(fillOrganizationId(urlTemplate, organizationId), {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const parsed = onboardCommunitySchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
