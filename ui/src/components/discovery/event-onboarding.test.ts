import { describe, expect, it } from "vitest";
import { type DiscoveryActivity, parseMaxJoins, upcomingEvents } from "./event-onboarding";

const now = Date.parse("2026-09-26T12:00:00Z");
const activity = (overrides: Partial<DiscoveryActivity>): DiscoveryActivity =>
  ({
    id: "a",
    kind: "event",
    status: "published",
    startsAt: "2026-09-27T10:00:00Z",
    endsAt: "2026-09-27T12:00:00Z",
    ...overrides,
  }) as DiscoveryActivity;

describe("event onboarding", () => {
  it("keeps upcoming and ongoing events, soonest first", () => {
    const events = upcomingEvents(
      [
        activity({ id: "later", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T12:00:00Z" }),
        activity({
          id: "ongoing",
          startsAt: "2026-09-26T11:00:00Z",
          endsAt: "2026-09-26T13:00:00Z",
        }),
        activity({ id: "past", startsAt: "2026-09-20T10:00:00Z", endsAt: "2026-09-20T12:00:00Z" }),
        activity({ id: "cancelled", status: "cancelled" }),
        activity({ id: "post", kind: "social" }),
      ],
      now,
    );
    expect(events.map((event) => event.id)).toEqual(["ongoing", "later"]);
  });

  it("parses the max joins limit and caps it at 500", () => {
    expect(parseMaxJoins("")).toBeUndefined();
    expect(parseMaxJoins("0")).toBeUndefined();
    expect(parseMaxJoins("25")).toBe(25);
    expect(parseMaxJoins("9000")).toBe(500);
  });
});
