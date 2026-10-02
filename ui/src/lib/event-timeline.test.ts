import { describe, expect, it } from "vitest";
import { buildEventTimeline, eventStartTime } from "./event-timeline";

const now = new Date("2026-09-26T12:00:00Z");
const viewer = { now, timeZone: "America/New_York", locale: "en-US" };

function event(
  id: string,
  startsAt: string | null,
  endsAt: string | null = null,
  timezone = "UTC",
) {
  return { id, startsAt, endsAt, timezone };
}

function ids(groups: { events: { id: string }[] }[]) {
  return groups.map((group) => group.events.map((e) => e.id));
}

describe("buildEventTimeline", () => {
  it("puts events that have not ended in upcoming, soonest first", () => {
    const timeline = buildEventTimeline(
      [
        event("later", "2026-10-06T18:00:00Z", "2026-10-06T20:00:00Z"),
        event("running", "2026-09-26T10:00:00Z", "2026-09-26T14:00:00Z"),
        event("ended", "2026-09-20T10:00:00Z", "2026-09-20T12:00:00Z"),
      ],
      viewer,
    );
    expect(ids(timeline.upcoming)).toEqual([["running"], ["later"]]);
    expect(timeline.upcomingCount).toBe(2);
  });

  it("uses the start when an event has no end", () => {
    const timeline = buildEventTimeline(
      [event("started", "2026-09-26T11:00:00Z"), event("soon", "2026-09-26T13:00:00Z")],
      viewer,
    );
    expect(ids(timeline.past)).toEqual([["started"]]);
    expect(ids(timeline.upcoming)).toEqual([["soon"]]);
  });

  it("lists past events most recent first", () => {
    const timeline = buildEventTimeline(
      [
        event("august", "2026-08-01T15:00:00Z", "2026-08-01T16:00:00Z"),
        event("september-morning", "2026-09-10T13:00:00Z", "2026-09-10T14:00:00Z"),
        event("september-evening", "2026-09-10T22:00:00Z", "2026-09-10T23:00:00Z"),
      ],
      viewer,
    );
    expect(ids(timeline.past)).toEqual([["september-evening", "september-morning"], ["august"]]);
    expect(timeline.pastCount).toBe(3);
  });

  it("groups by the viewer's calendar day, not UTC", () => {
    const timeline = buildEventTimeline(
      [
        event("late-evening", "2026-10-07T02:00:00Z", "2026-10-07T03:00:00Z"),
        event("afternoon", "2026-10-06T18:00:00Z", "2026-10-06T19:00:00Z"),
      ],
      viewer,
    );
    expect(ids(timeline.upcoming)).toEqual([["afternoon", "late-evening"]]);
    expect(timeline.upcoming[0]).toMatchObject({ day: "Oct 6", weekday: "Tuesday", year: null });
  });

  it("shows the year only for days outside the current year", () => {
    const timeline = buildEventTimeline(
      [
        event("next-year", "2027-01-05T18:00:00Z", "2027-01-05T19:00:00Z"),
        event("last-year", "2025-12-30T18:00:00Z", "2025-12-30T19:00:00Z"),
      ],
      viewer,
    );
    expect(timeline.upcoming[0]).toMatchObject({ day: "Jan 5", weekday: "Tuesday", year: "2027" });
    expect(timeline.past[0]).toMatchObject({ day: "Dec 30", year: "2025" });
  });

  it("keeps undated events in upcoming after dated days", () => {
    const timeline = buildEventTimeline(
      [event("tba", null), event("dated", "2026-10-01T18:00:00Z", "2026-10-01T19:00:00Z")],
      viewer,
    );
    expect(ids(timeline.upcoming)).toEqual([["dated"], ["tba"]]);
    expect(timeline.upcoming[1]).toMatchObject({
      key: "undated",
      day: "Date to be announced",
      weekday: "",
      year: null,
    });
  });
});

describe("eventStartTime", () => {
  it("shows the viewer-local start time", () => {
    expect(
      eventStartTime(event("a", "2026-10-06T22:30:00Z", null, "America/Chicago"), {
        timeZone: "America/Chicago",
        locale: "en-US",
      }),
    ).toEqual({ time: "5:30 PM", eventLocal: null });
  });

  it("adds the event-local time when the event is in another offset", () => {
    expect(
      eventStartTime(event("a", "2026-10-06T08:30:00Z", null, "Asia/Singapore"), {
        timeZone: "America/New_York",
        locale: "en-US",
      }),
    ).toEqual({ time: "4:30 AM", eventLocal: "4:30 PM GMT+8" });
  });

  it("treats differently named zones with the same offset as the same", () => {
    expect(
      eventStartTime(event("a", "2026-10-06T08:30:00Z", null, "Asia/Singapore"), {
        timeZone: "Asia/Shanghai",
        locale: "en-US",
      }),
    ).toEqual({ time: "4:30 PM", eventLocal: null });
  });

  it("returns nothing for an undated event", () => {
    expect(eventStartTime(event("a", null), { timeZone: "UTC", locale: "en-US" })).toBeNull();
  });
});
