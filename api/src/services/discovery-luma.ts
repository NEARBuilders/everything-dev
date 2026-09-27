import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { activitySchema, webUrl } from "../discovery-contract";

const calendarSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  url: webUrl,
});
const eventSchema = z.object({
  id: z.string().min(1).max(200),
  platform: z.literal("luma"),
  name: z.string().min(1),
  url: webUrl,
  start_at: z.iso.datetime({ offset: true }),
  end_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
  timezone: activitySchema.shape.timezone,
  visibility: z.enum(["public", "private", "members-only"]),
  location_visibility: z.enum(["public", "guests-only"]),
  geo_address_json: z
    .object({ full_address: z.string().nullish(), city_state: z.string().nullish() })
    .nullish(),
});
const pageSchema = z.object({
  entries: z.array(z.unknown()),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
});

export function createLumaCalendars(keys: string) {
  const apiKeys = [
    ...new Set(
      keys
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  async function request(path: string, key: string) {
    try {
      const response = await fetch(`https://public-api.luma.com${path}`, {
        headers: { accept: "application/json", "x-luma-api-key": key },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Luma unavailable");
      return await response.json();
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Luma is unavailable. Check the calendar connection and try again.",
      });
    }
  }
  async function registry() {
    const result = await Promise.allSettled(
      apiKeys.map(async (key) => ({
        key,
        calendar: calendarSchema.parse(await request("/v1/calendars/get", key)),
      })),
    );
    return {
      entries: result.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      unavailableCount: result.filter((r) => r.status === "rejected").length,
    };
  }
  return {
    list: async () => {
      const result = await registry();
      return {
        calendars: result.entries.map((entry) => entry.calendar),
        unavailableCount: result.unavailableCount,
      };
    },
    snapshot: async (calendarId: string) => {
      const { entries } = await registry();
      const entry = entries.find((entry) => entry.calendar.id === calendarId);
      if (!entry)
        throw new ORPCError("BAD_REQUEST", {
          message: "This Luma calendar is not connected or is unavailable.",
        });
      const events: z.infer<typeof eventSchema>[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({
          pagination_limit: "50",
          platforms: "luma",
          status: "approved",
          sort_column: "start_at",
          sort_direction: "asc",
        });
        params.append("access", "manage");
        params.append("access", "view");
        if (cursor) params.set("pagination_cursor", cursor);
        const parsed = pageSchema.safeParse(
          await request(`/v1/calendars/events/list?${params}`, entry.key),
        );
        if (!parsed.success)
          throw new ORPCError("BAD_REQUEST", {
            message: "Luma returned an incomplete calendar. Nothing was imported.",
          });
        for (const raw of parsed.data.entries) {
          const visibility = z.object({ visibility: z.string() }).safeParse(raw);
          if (
            visibility.success &&
            ["private", "members-only"].includes(visibility.data.visibility)
          )
            continue;
          const event = eventSchema.safeParse(raw);
          if (!event.success || Date.parse(event.data.end_at) < Date.parse(event.data.start_at))
            throw new ORPCError("BAD_REQUEST", {
              message: "Luma returned an invalid event. Nothing was imported.",
            });
          events.push(event.data);
        }
        if (!parsed.data.has_more) return { calendar: entry.calendar, events };
        cursor = parsed.data.next_cursor;
        if (!cursor || cursors.has(cursor)) break;
        cursors.add(cursor);
      }
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Calendar exceeds the import limit or pagination is incomplete. Nothing was imported.",
      });
    },
  };
}
