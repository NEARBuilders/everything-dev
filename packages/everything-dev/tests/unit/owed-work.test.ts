import { describe, expect, it } from "vitest";
import { computeImageTags, conditionImageTags } from "../../src/services/deploy/image";

describe("conditionImageTags — release-conditional tag movement", () => {
  it("release leg moves the computed tags verbatim", () => {
    const computed = computeImageTags({ shortSha: "abc1234", version: "2.0.0" });
    const conditioned = conditionImageTags(computed, true);
    expect(conditioned.tags).toEqual(computed.tags);
    expect(conditioned.pushLatest).toBe(computed.pushLatest);
  });

  it("non-release deploys push the sha tag only", () => {
    const rc = computeImageTags({ shortSha: "abc1234", version: "2.0.0-rc.21" });
    expect(conditionImageTags(rc, false)).toEqual({
      tags: ["sha-abc1234"],
      pushLatest: false,
      pushRc: false,
    });

    const stable = computeImageTags({ shortSha: "abc1234", version: "2.0.0" });
    expect(conditionImageTags(stable, false)).toEqual({
      tags: ["sha-abc1234"],
      pushLatest: false,
      pushRc: false,
    });

    const noVersion = computeImageTags({ shortSha: "abc1234" });
    expect(conditionImageTags(noVersion, false).tags).toEqual(["sha-abc1234"]);
  });
});
