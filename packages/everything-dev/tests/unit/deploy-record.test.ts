import { describe, expect, it } from "vitest";
import {
  type DeployRecord,
  DeployRecordSchema,
  deployRecordTsOf,
} from "../../src/services/registry/deploy-record";
import { deployAuditKeyOf } from "../../src/services/registry/pointer";

const RELEASE_WIRE: DeployRecord = {
  account: "dev.everything.near",
  gateway: "everything.dev",
  network: "mainnet",
  publishedAt: "2026-11-28T01:02:03.456Z",
  registryUrl:
    "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/apps%2Fdev.everything.near%2Feverything.dev%2Fbos.config.json",
  lockfile: { digest: "a".repeat(64), pointerDigest: "b".repeat(64) },
  platformManifest: {
    version: "2.0.0-rc.46",
    tag: "apps/dev.everything.near/everything.dev/manifest.json",
    tagIntegrity: `sha256-${"c".repeat(43)}`,
    record: "apps/dev.everything.near/everything.dev/versions/2.0.0-rc.46.json",
    integrity: `sha256-${"d".repeat(43)}`,
  },
};

describe("DeployRecordSchema — the per-deploy audit wire", () => {
  it("a release record round-trips: compose → stringify → parse → the same bytes", () => {
    const composed = DeployRecordSchema.parse(RELEASE_WIRE);
    const serialized = JSON.stringify(composed);
    const reparsed = DeployRecordSchema.parse(JSON.parse(serialized));

    expect(reparsed).toEqual(composed);
    expect(JSON.stringify(reparsed)).toBe(serialized);
    expect(serialized).toBe(JSON.stringify(RELEASE_WIRE));
  });

  it("a non-release record carries neither a lockfile nor a manifest pin", () => {
    const { lockfile: _lockfile, platformManifest: _manifest, ...plain } = RELEASE_WIRE;
    const record = DeployRecordSchema.parse(plain);

    expect(record).toEqual(plain);
    expect(record).not.toHaveProperty("lockfile");
    expect(record).not.toHaveProperty("platformManifest");
  });

  it.each([
    ["an empty account", { account: "" }],
    ["an empty gateway", { gateway: "" }],
    ["an empty network", { network: "" }],
    ["an empty publishedAt", { publishedAt: "" }],
    ["an empty registryUrl", { registryUrl: "" }],
    [
      "an empty manifest version",
      { platformManifest: { ...RELEASE_WIRE.platformManifest, version: "" } },
    ],
    [
      "an empty manifest integrity",
      { platformManifest: { ...RELEASE_WIRE.platformManifest, integrity: "" } },
    ],
    ["an empty lockfile digest", { lockfile: { digest: "", pointerDigest: "b".repeat(64) } }],
    ["a numeric timestamp", { publishedAt: 1764594123456 }],
  ])("rejects %s", (_label, override) => {
    expect(() => DeployRecordSchema.parse({ ...RELEASE_WIRE, ...override })).toThrow();
  });
});

describe("the record's key derivation", () => {
  it("munges the timestamp into its FastKV-safe path form", () => {
    expect(deployRecordTsOf("2026-11-28T01:02:03.456Z")).toBe("2026-11-28T01-02-03-456Z");
  });

  it("derives apps/<account>/<gateway>/deploys/<ts>.json — the form the history readers re-derive", () => {
    expect(
      deployAuditKeyOf("dev.everything.near", "everything.dev", "2026-11-28T01:02:03.456Z"),
    ).toBe("apps/dev.everything.near/everything.dev/deploys/2026-11-28T01-02-03-456Z.json");
  });
});
