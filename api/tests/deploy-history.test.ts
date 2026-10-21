import { Effect } from "effect";
import { pointerFingerprint } from "everything-dev/fingerprint";
import { describe, expect, it } from "vitest";
import {
  auditManifestKey,
  auditManifestKeyPrefix,
  buildDeployHistoryService,
  DeployHistoryReadError,
  historyUrlForKey,
  historyUrlForPrefix,
  parseAuditManifest,
  platformManifestKey,
  type RegistryHistoryEntry,
  registryConfigKey,
} from "@/lib/deploy-history";

const ACCOUNT = "app.near";
const GATEWAY = "gateway.near";

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function historyEntry(entry: {
  key?: string;
  blockHeight?: number;
  blockTimestampNs?: string;
  txHash?: string;
  value: unknown;
}): RegistryHistoryEntry {
  return {
    key: entry.key,
    blockHeight: entry.blockHeight ?? 0,
    blockTimestampNs: entry.blockTimestampNs ?? "",
    txHash: entry.txHash,
    value: entry.value,
  };
}

const fastKvResponse = (entries: RegistryHistoryEntry[]) => ({
  entries: entries.map((entry) => ({
    key: entry.key,
    block_height: entry.blockHeight,
    block_timestamp: entry.blockTimestampNs,
    tx_hash: entry.txHash,
    value: entry.value,
  })),
});

function fakeFetch(responses: { manifests: unknown; config: unknown; platform?: unknown }) {
  const requests: CapturedRequest[] = [];
  const fetchJson = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (init?.method === "POST") return responses.manifests;
    if (url.includes("platform.json")) return responses.platform ?? { entries: [] };
    return responses.config;
  };
  return { fetchJson, requests };
}

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

function manifestValueFixture() {
  return {
    account: ACCOUNT,
    gateway: GATEWAY,
    network: "mainnet",
    publishedAt: "2026-01-15T10:00:00.000Z",
    registryUrl: "https://registry.example.com",
    platformManifest: {
      file: `apps/${ACCOUNT}/${GATEWAY}/platform.json`,
      integrity: "sha256-platform",
    },
  };
}

function platformManifestValueFixture(frameworkVersion = "2.0.0-rc.17") {
  return {
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion,
    image: {
      ref: "ghcr.io/nearbuilders/everything-dev",
      tags: [`v${frameworkVersion}`],
    },
  };
}

function serviceFixture(responses: { manifests: unknown; config: unknown; platform?: unknown }) {
  const { fetchJson, requests } = fakeFetch(responses);
  return { service: buildDeployHistoryService(fetchJson), requests };
}

describe("audit-manifest key layout", () => {
  it("mirrors the deploy train's per-deploy manifest key", () => {
    expect(registryConfigKey(ACCOUNT, GATEWAY)).toBe(`apps/${ACCOUNT}/${GATEWAY}/bos.config.json`);
    expect(auditManifestKeyPrefix(ACCOUNT, GATEWAY)).toBe(`apps/${ACCOUNT}/${GATEWAY}/manifests/`);
    expect(auditManifestKey(ACCOUNT, GATEWAY, "2026-01-15T10:00:00.000Z")).toBe(
      "apps/app.near/gateway.near/manifests/2026-01-15T10-00-00-000Z.json",
    );
    expect(platformManifestKey(ACCOUNT, GATEWAY)).toBe(`apps/${ACCOUNT}/${GATEWAY}/platform.json`);
  });

  it("builds the history-by-prefix request against the network's registry", () => {
    const mainnet = historyUrlForPrefix({
      account: ACCOUNT,
      keyPrefix: auditManifestKeyPrefix(ACCOUNT, GATEWAY),
      limit: 20,
    });
    expect(mainnet).toBe(`https://kv.main.fastnear.com/v0/history/dev.everything.near/${ACCOUNT}`);

    const testnet = historyUrlForPrefix({
      account: "app.testnet",
      keyPrefix: auditManifestKeyPrefix("app.testnet", GATEWAY),
      limit: 20,
    });
    expect(testnet).toBe(
      "https://kv.test.fastnear.com/v0/history/dev.allthethings.testnet/app.testnet",
    );

    const override = historyUrlForPrefix({
      account: ACCOUNT,
      keyPrefix: auditManifestKeyPrefix(ACCOUNT, GATEWAY),
      limit: 20,
      registry: "custom.namespace",
    });
    expect(override).toContain("custom.namespace");
  });

  it("builds the exact-key config history URL with the encoded registry key", () => {
    expect(
      historyUrlForKey({
        account: ACCOUNT,
        keyPath: registryConfigKey(ACCOUNT, GATEWAY),
        limit: 20,
      }),
    ).toBe(
      `https://kv.main.fastnear.com/v0/history/dev.everything.near/${ACCOUNT}/apps%2Fapp.near%2Fgateway.near%2Fbos.config.json?limit=20`,
    );
  });
});

describe("audit-manifest schema parsing", () => {
  it("parses a real train-published manifest value", () => {
    const manifest = parseAuditManifest(manifestValueFixture());
    expect(manifest).not.toBeNull();
    expect(manifest?.publishedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(manifest?.platformManifest?.integrity).toBe("sha256-platform");
  });

  it("accepts manifests without a platform manifest and string-encoded values", () => {
    const { platformManifest: _omitted, ...bare } = manifestValueFixture();
    expect(parseAuditManifest(bare)?.platformManifest).toBeUndefined();
    expect(parseAuditManifest(JSON.stringify(bare))?.network).toBe("mainnet");
  });

  it("returns null for values that are not audit manifests", () => {
    expect(parseAuditManifest(null)).toBeNull();
    expect(parseAuditManifest({ nope: true })).toBeNull();
    expect(parseAuditManifest("not json")).toBeNull();
  });
});

describe("deploy history assembly", () => {
  it("resolves rows through the FastKV history endpoints and joins the config snapshot", async () => {
    const config = publishedConfigFixture();
    const { service, requests } = serviceFixture({
      manifests: fastKvResponse([
        historyEntry({
          key: auditManifestKey(ACCOUNT, GATEWAY, "2026-01-15T10:00:00.000Z"),
          blockHeight: 900,
          blockTimestampNs: "1768000000000000000",
          txHash: "tx2",
          value: manifestValueFixture(),
        }),
      ]),
      config: fastKvResponse([
        historyEntry({
          key: registryConfigKey(ACCOUNT, GATEWAY),
          blockHeight: 900,
          blockTimestampNs: "1768000000000000000",
          txHash: "tx2",
          value: config,
        }),
      ]),
      platform: fastKvResponse([
        historyEntry({
          key: platformManifestKey(ACCOUNT, GATEWAY),
          blockHeight: 900,
          blockTimestampNs: "1768000000000000000",
          value: platformManifestValueFixture(),
        }),
      ]),
    });

    const deploys = await Effect.runPromise(
      service.listDeploys({ account: ACCOUNT, gateway: GATEWAY, limit: 20 }),
    );

    expect(deploys).toHaveLength(1);
    expect(deploys[0]).toMatchObject({
      key: auditManifestKey(ACCOUNT, GATEWAY, "2026-01-15T10:00:00.000Z"),
      publishedAt: "2026-01-15T10:00:00.000Z",
      network: "mainnet",
      rolledBackFrom: "2026-01-10T09:00:00.000Z",
      fingerprint: pointerFingerprint(config as never),
      imageRef: "ghcr.io/nearbuilders/everything-dev@v2.0.0-rc.17",
    });

    const manifestRequest = requests.find((r) => r.init?.method === "POST");
    expect(manifestRequest?.init?.method).toBe("POST");
    const requestBody = manifestRequest?.init?.body;
    expect(typeof requestBody === "string" ? JSON.parse(requestBody) : undefined).toEqual({
      key_prefix: auditManifestKeyPrefix(ACCOUNT, GATEWAY),
      asc: false,
      limit: 20,
    });
    expect(requests.filter((r) => r.init?.method !== "POST").map((r) => r.url)).toEqual([
      expect.stringContaining(encodeURIComponent(registryConfigKey(ACCOUNT, GATEWAY))),
      expect.stringContaining(encodeURIComponent(platformManifestKey(ACCOUNT, GATEWAY))),
    ]);
  });

  it("carries the platform pin in force when the deploy did not rewrite platform.json", async () => {
    const { service } = serviceFixture({
      manifests: fastKvResponse([
        historyEntry({
          blockHeight: 900,
          value: manifestValueFixture(),
        }),
        historyEntry({
          blockHeight: 880,
          value: { ...manifestValueFixture(), publishedAt: "2026-01-14T10:00:00.000Z" },
        }),
      ]),
      config: fastKvResponse([]),
      platform: fastKvResponse([
        historyEntry({
          key: platformManifestKey(ACCOUNT, GATEWAY),
          blockHeight: 880,
          value: platformManifestValueFixture("1.9.0"),
        }),
      ]),
    });

    const deploys = await Effect.runPromise(
      service.listDeploys({ account: ACCOUNT, gateway: GATEWAY, limit: 20 }),
    );

    expect(deploys).toHaveLength(2);
    expect(deploys[0]?.imageRef).toBe("ghcr.io/nearbuilders/everything-dev@v1.9.0");
    expect(deploys[1]?.imageRef).toBe("ghcr.io/nearbuilders/everything-dev@v1.9.0");
  });

  it("omits the image pin for namespaces that never published a platform manifest", async () => {
    const { service } = serviceFixture({
      manifests: fastKvResponse([
        historyEntry({ blockHeight: 900, value: manifestValueFixture() }),
      ]),
      config: fastKvResponse([]),
      platform: fastKvResponse([]),
    });

    const deploys = await Effect.runPromise(
      service.listDeploys({ account: ACCOUNT, gateway: GATEWAY, limit: 20 }),
    );

    expect(deploys).toHaveLength(1);
    expect(deploys[0]?.imageRef).toBeUndefined();
  });

  it("drops rows whose manifest value does not parse", async () => {
    const { service } = serviceFixture({
      manifests: fastKvResponse([
        historyEntry({ blockHeight: 1, value: { nope: true } }),
        historyEntry({ blockHeight: 2, value: manifestValueFixture() }),
      ]),
      config: fastKvResponse([]),
    });

    const deploys = await Effect.runPromise(
      service.listDeploys({ account: ACCOUNT, gateway: GATEWAY, limit: 20 }),
    );
    expect(deploys).toHaveLength(1);
    expect(deploys[0]?.fingerprint).toBeUndefined();
    expect(deploys[0]?.rolledBackFrom).toBeUndefined();
  });

  it("fails with a read error when the registry is unreachable", async () => {
    const service = buildDeployHistoryService(async () => {
      throw new Error("network down");
    });
    const error = await Effect.runPromise(
      Effect.flip(service.listDeploys({ account: ACCOUNT, gateway: GATEWAY, limit: 20 })),
    );
    expect(error).toBeInstanceOf(DeployHistoryReadError);
  });
});
