import { Effect } from "effect";
import { pointerDigest } from "everything-dev/digest";
import {
  type DeployRecord,
  DeployRecordSchema,
  deployRecordTsOf,
  keyPathOf,
  ManifestSchema,
  ManifestTagSchema,
  type RegistryHistoryEntry,
  type RegistryKey,
  runtimeRefOf,
} from "everything-dev/registry";
import type { DeployManifestEntry } from "everything-dev/registry/fastkv";
import { describe, expect, it, vi } from "vitest";
import {
  buildDeployHistoryService,
  DeployHistoryReadError,
  type DeployHistorySource,
  type DeploySummary,
  imagePinOfVersionRecord,
  imageRefOfPin,
  ListDeploysOutputSchema,
  releaseVersionAtBlock,
} from "@/lib/deploy-history";

const ACCOUNT = "app.near";
const GATEWAY = "gateway.near";
const REF = runtimeRefOf({ accountId: ACCOUNT, gatewayId: GATEWAY });
const IMAGE_REF = "ghcr.io/nearbuilders/everything-dev";
const REGISTRY_URL =
  "https://kv.main.fastnear.com/v0/latest/dev.everything.near/app.near/apps%2Fapp.near%2Fgateway.near%2Fbos.config.json";

const wireKey = {
  deployRecord: (publishedAt: string) =>
    keyPathOf({ kind: "deployRecord", ref: REF, ts: deployRecordTsOf(publishedAt) }),
  config: keyPathOf({ kind: "runtimeConfig", ref: REF }),
  manifestTag: keyPathOf({ kind: "manifest", ref: REF }),
  version: (version: string) => keyPathOf({ kind: "version", ref: REF, version }),
};

function publishedConfigFixture() {
  return {
    account: ACCOUNT,
    extends: "bos://platform.near/root",
    domain: GATEWAY,
    app: {
      ui: {
        production: "https://cdn.example.com/ui",
        pin: { manifest: "https://cdn.example.com/ui/mf.json", integrity: "sha256-ui" },
      },
    },
    plugins: {
      auth: {
        production: "https://cdn.example.com/auth",
        pin: { manifest: "https://cdn.example.com/auth/mf.json", integrity: "sha256-auth" },
      },
    },
    rolledBackFrom: "2026-01-10T09:00:00.000Z",
  };
}

function deployRecordFixture(opts: {
  publishedAt: string;
  release?: { version: string };
}): DeployRecord {
  return DeployRecordSchema.parse({
    account: ACCOUNT,
    gateway: GATEWAY,
    network: "mainnet",
    publishedAt: opts.publishedAt,
    registryUrl: REGISTRY_URL,
    ...(opts.release
      ? {
          platformManifest: {
            version: opts.release.version,
            tag: wireKey.manifestTag,
            tagIntegrity: "sha384-tag",
            record: wireKey.version(opts.release.version),
            integrity: "sha384-record",
          },
        }
      : {}),
  });
}

function versionRecordFixture(version: string, image = { ref: IMAGE_REF, tags: [`v${version}`] }) {
  return ManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: version,
    everyPluginVersion: "0.19.2",
    image,
    catalog: {},
    sharedDeps: {},
    templateInventory: [],
    compat: { minChild: "2.0.0-rc.37" },
  });
}

function manifestTagFixture(version: string) {
  return ManifestTagSchema.parse({
    schemaVersion: 1,
    version,
    digest: "4d5c80037cc00a8b663b83146d65fd5e6c3686b46ab7efdf0970aad04f6042ba",
  });
}

interface RecordEntryInput {
  publishedAt: string;
  blockHeight: number;
  release?: { version: string };
  key?: string;
}

function recordEntryFixture(opts: RecordEntryInput) {
  return {
    key: opts.key ?? wireKey.deployRecord(opts.publishedAt),
    blockHeight: opts.blockHeight,
    blockTimestampNs: "1768000000000000000",
    value: deployRecordFixture(opts),
  };
}

function historyEntry(entry: { blockHeight?: number; value: unknown }): RegistryHistoryEntry {
  return {
    blockHeight: entry.blockHeight ?? 0,
    blockTimestampNs: "1768000000000000000",
    value: entry.value,
  };
}

interface SourceFixtureInput {
  records?: DeployManifestEntry[];
  configEntries?: RegistryHistoryEntry[];
  tagEntries?: RegistryHistoryEntry[];
  versionRecords?: Record<string, unknown>;
}

function sourceFixture(input: SourceFixtureInput = {}): DeployHistorySource & {
  limitRequests: number[];
} {
  const limitRequests: number[] = [];
  return {
    limitRequests,
    listDeployRecords: async (opts) => {
      limitRequests.push(opts.limit);
      return input.records ?? [];
    },
    keyHistory: async (key: RegistryKey, limit: number) => {
      limitRequests.push(limit);
      if (key.kind === "manifest") return input.tagEntries ?? [];
      if (key.kind === "runtimeConfig") return input.configEntries ?? [];
      return [];
    },
    readVersionRecord: async (key: RegistryKey) =>
      key.kind === "version" ? (input.versionRecords?.[key.version] ?? null) : null,
  };
}

const runList = (source: DeployHistorySource, limit = 20): Promise<DeploySummary[]> =>
  Effect.runPromise(
    buildDeployHistoryService(source).listDeploys({
      account: ACCOUNT,
      gateway: GATEWAY,
      limit,
    }),
  );

describe("golden wire keys (ADR 0040)", () => {
  it("derives the exact keys the train writes, through the key model", () => {
    expect(wireKey.config).toBe(`apps/${ACCOUNT}/${GATEWAY}/bos.config.json`);
    expect(wireKey.manifestTag).toBe(`apps/${ACCOUNT}/${GATEWAY}/manifest.json`);
    expect(wireKey.deployRecord("2026-11-12T01:16:17.604Z")).toBe(
      `apps/${ACCOUNT}/${GATEWAY}/deploys/2026-11-12T01-16-17-604Z.json`,
    );
    expect(wireKey.version("2.0.0-rc.44")).toBe(
      `apps/${ACCOUNT}/${GATEWAY}/versions/2.0.0-rc.44.json`,
    );
    expect(deployRecordTsOf("2026-11-12T01:16:17.604Z")).toBe("2026-11-12T01-16-17-604Z");
  });
});

describe("deploy record parsing", () => {
  it("parses the train's post-cutover record shape", () => {
    const record = deployRecordFixture({ publishedAt: "2026-11-12T01:16:17.604Z" });
    expect(record.publishedAt).toBe("2026-11-12T01:16:17.604Z");
    expect(record.lockfile).toBeUndefined();

    const withRelease = deployRecordFixture({
      publishedAt: "2026-11-12T01:16:17.604Z",
      release: { version: "2.0.0-rc.44" },
    });
    expect(withRelease.platformManifest).toEqual({
      version: "2.0.0-rc.44",
      tag: wireKey.manifestTag,
      tagIntegrity: "sha384-tag",
      record: wireKey.version("2.0.0-rc.44"),
      integrity: "sha384-record",
    });
  });

  it("drops pre-cutover audit manifests whose platformManifest shape no longer exists", () => {
    const legacy = {
      account: ACCOUNT,
      gateway: GATEWAY,
      network: "mainnet",
      publishedAt: "2026-01-15T10:00:00.000Z",
      registryUrl: "https://registry.example.com",
      platformManifest: { file: `apps/${ACCOUNT}/${GATEWAY}/platform.json`, integrity: "sha256" },
    };
    expect(DeployRecordSchema.safeParse(legacy).success).toBe(false);
  });
});

describe("release pin resolution", () => {
  it("reads the image pin as ref:tag from the version record", () => {
    const pin = imagePinOfVersionRecord(versionRecordFixture("2.0.0-rc.44"));
    expect(pin).toEqual({ image: IMAGE_REF, tag: "v2.0.0-rc.44" });
    expect(imageRefOfPin(pin!)).toBe(`${IMAGE_REF}:v2.0.0-rc.44`);
  });

  it("omits the pin when the version record has no image tags", () => {
    const pin = imagePinOfVersionRecord(
      versionRecordFixture("2.0.0-rc.44", { ref: IMAGE_REF, tags: [] }),
    );
    expect(pin).toBeUndefined();
  });

  it("resolves the version in force at a block from the tag history", () => {
    const tagEntries = [
      historyEntry({ blockHeight: 880, value: manifestTagFixture("2.0.0-rc.44") }),
      historyEntry({ blockHeight: 500, value: manifestTagFixture("2.0.0-rc.43") }),
    ];
    expect(releaseVersionAtBlock(tagEntries, 900)).toBe("2.0.0-rc.44");
    expect(releaseVersionAtBlock(tagEntries, 880)).toBe("2.0.0-rc.44");
    expect(releaseVersionAtBlock(tagEntries, 879)).toBe("2.0.0-rc.43");
    expect(releaseVersionAtBlock(tagEntries, 400)).toBeUndefined();
  });
});

describe("deploy history assembly", () => {
  it("resolves a release-leg deploy with the config joined at the record's block", async () => {
    const config = publishedConfigFixture();
    const source = sourceFixture({
      records: [
        recordEntryFixture({
          publishedAt: "2026-11-12T01:16:17.604Z",
          blockHeight: 900,
          release: { version: "2.0.0-rc.44" },
        }),
      ],
      configEntries: [historyEntry({ blockHeight: 900, value: config })],
      tagEntries: [historyEntry({ blockHeight: 900, value: manifestTagFixture("2.0.0-rc.44") })],
      versionRecords: { "2.0.0-rc.44": versionRecordFixture("2.0.0-rc.44") },
    });

    const rows = await runList(source);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: wireKey.deployRecord("2026-11-12T01:16:17.604Z"),
      publishedAt: "2026-11-12T01:16:17.604Z",
      network: "mainnet",
      registryUrl: REGISTRY_URL,
      pointerDigest: pointerDigest(config as never),
      rolledBackFrom: "2026-01-10T09:00:00.000Z",
      releaseVersion: "2.0.0-rc.44",
      imageRef: `${IMAGE_REF}:v2.0.0-rc.44`,
      platformManifest: {
        version: "2.0.0-rc.44",
        tag: wireKey.manifestTag,
        record: wireKey.version("2.0.0-rc.44"),
      },
    });
    expect(ListDeploysOutputSchema.parse({ deploys: rows })).toEqual({ deploys: rows });
  });

  it("carries the version still in force when the deploy wrote no release pointer", async () => {
    const source = sourceFixture({
      records: [
        recordEntryFixture({ publishedAt: "2026-11-12T01:16:17.604Z", blockHeight: 900 }),
        recordEntryFixture({ publishedAt: "2026-11-11T22:39:05.034Z", blockHeight: 870 }),
      ],
      configEntries: [],
      tagEntries: [historyEntry({ blockHeight: 880, value: manifestTagFixture("2.0.0-rc.44") })],
      versionRecords: { "2.0.0-rc.44": versionRecordFixture("2.0.0-rc.44") },
    });

    const rows = await runList(source);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.releaseVersion).toBe("2.0.0-rc.44");
    expect(rows[0]?.imageRef).toBe(`${IMAGE_REF}:v2.0.0-rc.44`);
    expect(rows[1]?.releaseVersion).toBeUndefined();
    expect(rows[1]?.imageRef).toBeUndefined();
  });

  it("omits the image pin when the version record is absent from the namespace", async () => {
    const source = sourceFixture({
      records: [
        recordEntryFixture({
          publishedAt: "2026-11-12T01:16:17.604Z",
          blockHeight: 900,
          release: { version: "2.0.0-rc.44" },
        }),
      ],
      versionRecords: {},
    });

    const rows = await runList(source);

    expect(rows[0]?.releaseVersion).toBe("2.0.0-rc.44");
    expect(rows[0]?.imageRef).toBeUndefined();
  });

  it("binds pointerDigest only to the config published in the record's atomic write", async () => {
    const config = publishedConfigFixture();
    const source = sourceFixture({
      records: [
        recordEntryFixture({
          publishedAt: "2026-11-12T01:16:17.604Z",
          blockHeight: 900,
          release: { version: "2.0.0-rc.44" },
        }),
      ],
      configEntries: [historyEntry({ blockHeight: 899, value: config })],
      versionRecords: { "2.0.0-rc.44": versionRecordFixture("2.0.0-rc.44") },
    });

    const rows = await runList(source);

    expect(rows[0]?.pointerDigest).toBeUndefined();
    expect(rows[0]?.rolledBackFrom).toBeUndefined();
  });

  it("drops rows whose value is not a deploy record", async () => {
    const source = sourceFixture({
      records: [
        {
          key: "apps/app.near/gateway.near/deploys/junk.json",
          blockHeight: 1,
          blockTimestampNs: "",
          value: { nope: true },
        },
        recordEntryFixture({ publishedAt: "2026-11-12T01:16:17.604Z", blockHeight: 2 }),
      ],
    });

    const rows = await runList(source);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.blockHeight).toBe(2);
  });

  it("re-derives the row key through the key model when history omits it", async () => {
    const source = sourceFixture({
      records: [
        recordEntryFixture({
          publishedAt: "2026-11-12T01:16:17.604Z",
          blockHeight: 900,
          key: "",
        }),
      ],
    });

    const rows = await runList(source);

    expect(rows[0]?.key).toBe(wireKey.deployRecord("2026-11-12T01:16:17.604Z"));
  });
});

describe("deploy history service", () => {
  it("reads all three histories through the typed key model with the clamped limit", async () => {
    const source = sourceFixture();
    await runList(source, 500);

    expect(source.limitRequests).toEqual([200, 200, 200]);
  });

  it("fails with a read error when the registry is unreachable", async () => {
    const source = sourceFixture();
    vi.spyOn(source, "listDeployRecords").mockRejectedValue(new Error("network down"));
    const error = await Effect.runPromise(
      Effect.flip(
        buildDeployHistoryService(source).listDeploys({
          account: ACCOUNT,
          gateway: GATEWAY,
          limit: 20,
        }),
      ),
    );
    expect(error).toBeInstanceOf(DeployHistoryReadError);
  });

  it("fails with a read error when a version-record read is unreachable", async () => {
    const source = sourceFixture({
      records: [
        recordEntryFixture({
          publishedAt: "2026-11-12T01:16:17.604Z",
          blockHeight: 900,
          release: { version: "2.0.0-rc.44" },
        }),
      ],
    });
    vi.spyOn(source, "readVersionRecord").mockRejectedValue(new Error("registry unreachable"));

    const error = await Effect.runPromise(
      Effect.flip(
        buildDeployHistoryService(source).listDeploys({
          account: ACCOUNT,
          gateway: GATEWAY,
          limit: 20,
        }),
      ),
    );
    expect(error).toBeInstanceOf(DeployHistoryReadError);
  });
});
