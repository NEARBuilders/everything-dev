import { z } from "zod";

export const MEMBERSHIP_ENDED_ACTION = "rejoin-organization";

export const ONBOARD_ORGANIZATION_ID_PLACEHOLDER = "{organizationId}";

const SAFE_HREF = /^(\/(?![/\\])|https:\/\/)/;

const onboardHrefSchema = z
  .string()
  .trim()
  .regex(SAFE_HREF, 'must be an app path ("/…") or an https:// URL');

export const onboardLinkSchema = z.object({
  href: onboardHrefSchema,
  label: z.string().trim().min(1).optional(),
});

export const onboardConfigSchema = z.object({
  links: z
    .object({
      next: z.union([z.literal(false), onboardLinkSchema]).optional(),
      home: onboardLinkSchema.optional(),
      explore: onboardLinkSchema
        .refine(
          (link) => !link.href.includes(ONBOARD_ORGANIZATION_ID_PLACEHOLDER),
          "explore links have no organization to fill in",
        )
        .optional(),
    })
    .optional(),
  community: z
    .object({
      url: onboardHrefSchema.refine((url) => url.startsWith("/"), "must be an app path"),
    })
    .optional(),
});

export const onboardCommunitySchema = z.object({
  name: z.string().trim().min(1).optional(),
  href: onboardHrefSchema.optional(),
  channels: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        url: z.string().regex(/^https?:\/\//),
      }),
    )
    .optional(),
});

export type OnboardLink = z.infer<typeof onboardLinkSchema>;
export type OnboardConfig = z.infer<typeof onboardConfigSchema>;
export type OnboardCommunity = z.infer<typeof onboardCommunitySchema>;

export function fillOrganizationId(template: string, organizationId: string): string {
  return template.replaceAll(
    ONBOARD_ORGANIZATION_ID_PLACEHOLDER,
    encodeURIComponent(organizationId),
  );
}
