import { describe, expect, it } from "vitest";
import { chainHeadPinLagNotice } from "../../src/services/platform/manifest";

describe("chainHeadPinLagNotice", () => {
  it("notices when the chain head advanced past the authored pin", () => {
    const notice = chainHeadPinLagNotice("2.0.0-rc.28", "2.0.0-rc.27");
    expect(notice).toBeDefined();
    expect(notice).toContain("2.0.0-rc.28");
    expect(notice).toContain("2.0.0-rc.27");
    expect(notice).toContain("bos upgrade");
  });

  it("stays silent when the pin is current with the chain head", () => {
    expect(chainHeadPinLagNotice("2.0.0-rc.28", "2.0.0-rc.28")).toBeUndefined();
  });

  it("stays silent when the pin is ahead of the head (override posture)", () => {
    expect(chainHeadPinLagNotice("2.0.0-rc.28", "2.0.0-rc.29")).toBeUndefined();
  });

  it("stays silent when either side is unknown — the pin never yells at the parent runtime", () => {
    expect(chainHeadPinLagNotice("2.0.0-rc.28", undefined)).toBeUndefined();
    expect(chainHeadPinLagNotice(undefined, "2.0.0-rc.27")).toBeUndefined();
  });
});
