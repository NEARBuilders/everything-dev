import { describe, expect, it } from "vitest";
import { activityDateTile, activityTimeRange, type PublicActivity } from "./event-list";

const activity = {
  startsAt: "2026-09-28T14:30:00.000Z",
  endsAt: "2026-09-28T16:00:00.000Z",
  timezone: "UTC",
} as PublicActivity;

describe("activity locale formatting", () => {
  it("formats dates with the active locale", () => {
    const english = activityDateTile(activity, "en");
    const french = activityDateTile(activity, "fr");
    const chinese = activityDateTile(activity, "zh");

    expect(english?.month).toBe("Sep");
    expect(french?.month).toBe("sept.");
    expect(chinese?.month).toBe("9月");
    expect(new Set([english?.full, french?.full, chinese?.full]).size).toBe(3);
  });

  it("formats time ranges with the active locale", () => {
    expect(activityTimeRange(activity, "en")).toContain("2:30");
    expect(activityTimeRange(activity, "fr")).toContain("14:30");
    expect(activityTimeRange(activity, "zh")).toContain("14:30");
  });
});
