import { describe, expect, it } from "vitest";
import { getSnapshotBootHealth } from "../../src/routes/health";

/**
 * The /health composition-provenance block (ADR 0041 ticket 03): the overall
 * status stays "ready" — the runtime IS ready to serve — the degraded marker
 * is provenance, and it clears the moment the watch adopts a published
 * generation.
 */

describe("getSnapshotBootHealth", () => {
  it("a registry-sourced boot is never degraded", () => {
    expect(getSnapshotBootHealth(false, false)).toEqual({
      booted: false,
      adopted: false,
      degraded: false,
    });
    expect(getSnapshotBootHealth(false, true)).toEqual({
      booted: false,
      adopted: true,
      degraded: false,
    });
  });

  it("a snapshot boot is degraded until the watch adopts", () => {
    expect(getSnapshotBootHealth(true, false)).toEqual({
      booted: true,
      adopted: false,
      degraded: true,
    });
    expect(getSnapshotBootHealth(true, true)).toEqual({
      booted: true,
      adopted: true,
      degraded: false,
    });
  });
});
