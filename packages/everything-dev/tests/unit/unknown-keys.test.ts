import { describe, expect, it } from "vitest";
import { collectUnknownKeys } from "../../src/services/resolution/unknown-keys";
import { BosConfigSchema } from "../../src/types";

describe("collectUnknownKeys", () => {
  it("flags a retired nested key without dropping the known siblings", () => {
    const keys = collectUnknownKeys(
      { ci: { image: "ghcr.io/acme/app:sha-abc", railway: { service: "app" } } },
      BosConfigSchema,
    );
    expect(keys).toEqual(["ci.image"]);
  });

  it("flags mistyped top-level keys", () => {
    expect(collectUnknownKeys({ acount: "x.near" }, BosConfigSchema)).toEqual(["acount"]);
  });

  it("returns nothing for a fully known config", () => {
    expect(
      collectUnknownKeys(
        {
          account: "a.near",
          domain: "a.dev",
          extends: "bos://p.near/p.dev",
          platform: "2.0.0-rc.14",
          repository: "https://github.com/acme/app",
          ci: { railway: { service: "app" } },
          publish: { auth: "key" },
        },
        BosConfigSchema,
      ),
    ).toEqual([]);
  });

  it("does not descend into records — plugin keys are not unknown keys", () => {
    expect(
      collectUnknownKeys({ plugins: { myPlugin: "local:plugins/my-plugin" } }, BosConfigSchema),
    ).toEqual([]);
  });

  it("is safe on non-object values", () => {
    expect(collectUnknownKeys(null, BosConfigSchema)).toEqual([]);
    expect(collectUnknownKeys("config", BosConfigSchema)).toEqual([]);
    expect(collectUnknownKeys(["a"], BosConfigSchema)).toEqual([]);
  });
});
