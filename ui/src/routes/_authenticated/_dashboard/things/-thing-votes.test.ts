import { describe, expect, it } from "vitest";
import { optimisticUpvoteCount } from "./-thing-votes";

describe("optimistic Thing upvote count", () => {
  it("increments immediately when adding an upvote", () => {
    expect(optimisticUpvoteCount(4, true)).toBe(5);
  });

  it("decrements immediately when removing an upvote", () => {
    expect(optimisticUpvoteCount(4, false)).toBe(3);
  });

  it("never produces a negative count", () => {
    expect(optimisticUpvoteCount(0, false)).toBe(0);
  });
});
