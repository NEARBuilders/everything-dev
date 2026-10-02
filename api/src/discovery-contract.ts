import { oc } from "@orpc/contract";
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { z } from "zod";

export const webUrl = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL");
export const profileSchema = z
  .object({
    nodeId: z.uuid(),
    summary: z.string().trim().max(1000),
    location: z.string().trim().max(120),
    region: z.string().trim().max(120),
    latitude: z.number().min(-85).max(85).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    channels: z.array(z.object({ label: z.string().trim().min(1).max(80), url: webUrl })).max(10),
    published: z.boolean(),
    geocodedLocation: z.string().trim().max(120).nullable().optional(),
    geocodeHint: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (p) => (p.latitude === null) === (p.longitude === null),
    "Provide both coordinates or neither",
  )
  .refine((p) => p.latitude === null || p.location.length > 0, "Confirm the location label");
export type DiscoveryProfile = z.infer<typeof profileSchema>;
export const activitySchema = z.object({
  id: z.uuid(),
  ownerNodeId: z.uuid(),
  luma: z
    .object({
      calendarId: z.string(),
      eventId: z.string(),
      syncedAt: z.iso.datetime(),
      available: z.boolean(),
      hidden: z.boolean().optional(),
    })
    .optional(),
  nodeIds: z.array(z.uuid()).min(1).max(30),
  kind: z.enum(["event", "social"]),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000),
  url: webUrl,
  source: z.string().trim().min(1).max(120),
  publishedAt: z.iso.datetime(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  timezone: z
    .string()
    .max(80)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use a valid timezone"),
  venue: z.string().trim().max(240),
  status: z.enum(["draft", "published", "cancelled"]),
});
export type DiscoveryActivity = z.infer<typeof activitySchema>;
export const activityInput = activitySchema
  .omit({ id: true, luma: true })
  .extend({ id: z.uuid().optional() })
  .superRefine((v, ctx) => {
    if (!v.nodeIds.includes(v.ownerNodeId))
      ctx.addIssue({ code: "custom", message: "Include the owner node", path: ["nodeIds"] });
    if (v.kind === "event" && (!v.startsAt || !v.endsAt || v.endsAt < v.startsAt || !v.venue))
      ctx.addIssue({
        code: "custom",
        message: "Events need a venue and valid start/end times",
        path: ["startsAt"],
      });
    if (v.kind === "social" && (v.nodeIds.length !== 1 || v.status === "cancelled"))
      ctx.addIssue({
        code: "custom",
        message: "Social Updates belong to one node and cannot be cancelled",
        path: ["kind"],
      });
  });
export const discoveryNodeSchema = profileSchema.safeExtend({
  featured: z.string().nullable(),
  active: z.boolean(),
  activityReason: z.string(),
  upcoming: z.boolean(),
  events: z.array(activitySchema),
  updates: z.array(activitySchema),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
  kind: z.string().nullable(),
});
export const reportSchema = z.object({
  id: z.uuid(),
  targetId: z.uuid(),
  kind: z.enum(["profile", "activity"]),
  reason: z.string(),
  note: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export const featureInput = z.object({
  nodeId: z.uuid(),
  label: z.string().trim().min(1).max(80),
  expiresAt: z.iso.datetime(),
});
export const reportInput = z.object({
  targetId: z.uuid(),
  kind: z.enum(["profile", "activity"]),
  reason: z.string().trim().min(5).max(1000),
  token: z.uuid(),
});
export const measurementInput = z
  .object({
    visitId: z.uuid(),
    nodeId: z.uuid().nullable(),
    campaign: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_-]*$/),
    kind: z.enum(["visit", "open", "event", "channel", "share"]),
    target: z.string().max(2000).default(""),
    consent: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "event" && !z.uuid().safeParse(value.target).success)
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "Event target must be an activity ID",
      });
  });
export type DiscoveryMeasurement = z.infer<typeof measurementInput>;
export const discoveryContract = {
  listDiscoveryLumaCalendars: oc
    .input(z.object({ nodeId: z.uuid() }))
    .output(
      z.object({
        calendars: z.array(z.object({ id: z.string(), name: z.string(), url: webUrl })),
        unavailableCount: z.number(),
        connection: z
          .object({
            calendarId: z.string(),
            calendarName: z.string(),
            syncedAt: z.iso.datetime(),
            error: z.string().nullable(),
          })
          .nullable(),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  disconnectDiscoveryLuma: oc
    .input(z.object({ nodeId: z.uuid() }))
    .output(z.object({ disconnected: z.boolean() }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  importDiscoveryLuma: oc
    .input(z.object({ nodeId: z.uuid(), calendarId: z.string().min(1).max(200) }))
    .output(
      z.object({
        imported: z.number(),
        updated: z.number(),
        withdrawn: z.number(),
        skipped: z.number(),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  trackDiscovery: oc
    .input(measurementInput)
    .output(z.object({ accepted: z.boolean() }))
    .errors({ BAD_REQUEST }),
  getDiscoveryMetrics: oc
    .output(
      z.object({
        visits: z.number(),
        activatedVisits: z.number(),
        rows: z.array(
          z.object({
            nodeId: z.string().nullable(),
            campaign: z.string(),
            kind: z.string(),
            count: z.number(),
          }),
        ),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN }),
  getDiscoveryStudio: oc
    .output(
      z.object({
        isAdmin: z.boolean(),
        nodes: z.array(discoveryNodeSchema),
        reports: z.array(reportSchema),
        curators: z.array(z.string()),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN }),
  setDiscoveryCurator: oc
    .input(z.object({ userId: z.string().trim().min(1).max(200), enabled: z.boolean() }))
    .output(z.object({ success: z.boolean() }))
    .errors({ UNAUTHORIZED, FORBIDDEN }),
  featureDiscoveryNode: oc
    .input(featureInput)
    .output(z.object({ success: z.boolean() }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  reportDiscoveryContent: oc
    .input(reportInput)
    .output(z.object({ success: z.boolean() }))
    .errors({ NOT_FOUND, BAD_REQUEST }),
  moderateDiscoveryReport: oc
    .input(
      z.object({
        reportId: z.uuid(),
        action: z.enum(["dismiss", "unpublish"]),
        note: z.string().trim().min(1).max(1000),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  getDiscoveryHistory: oc
    .input(z.object({ nodeId: z.uuid() }))
    .output(
      z.array(
        z.object({
          id: z.uuid(),
          targetId: z.string(),
          actorId: z.string(),
          action: z.string(),
          recordedAt: z.string(),
        }),
      ),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  saveDiscoveryActivity: oc
    .input(activityInput)
    .output(activitySchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  listDiscoveryActivities: oc
    .input(z.object({ nodeId: z.uuid() }))
    .output(z.array(activitySchema))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  getDiscoveryActivity: oc.input(z.object({ id: z.uuid() })).output(activitySchema.nullable()),
  listDiscovery: oc
    .input(
      z.object({
        query: z.string().max(120).optional(),
        region: z.string().max(120).optional(),
        active: z.boolean().optional(),
        upcoming: z.boolean().optional(),
      }),
    )
    .output(z.array(discoveryNodeSchema)),
  getDiscoveryNode: oc.input(z.object({ nodeId: z.uuid() })).output(discoveryNodeSchema.nullable()),
  getDiscoveryProfile: oc
    .input(z.object({ nodeId: z.uuid() }))
    .output(profileSchema.nullable())
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  saveDiscoveryProfile: oc
    .input(profileSchema)
    .output(profileSchema)
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
};
