import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layer, ManagedRuntime } from "effect";
import { HostingAdapter } from "everything-dev/hosting";
import { dockerHostingAdapterLayer } from "everything-dev/hosting/docker";
import {
  DeployRecordSchema,
  deployRecordTsOf,
  keyPathOf,
  ManifestSchema,
  ManifestTagSchema,
  type RegistryHistoryEntry,
  runtimeRefOf,
} from "everything-dev/registry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseLive } from "@/db/layer";
import {
  buildDeployHistoryService,
  DeployHistoryService,
  type DeployHistorySource,
} from "@/lib/deploy-history";
import { buildReconciler, instanceNameFor, type ReconcilerStatusSnapshot } from "@/lib/reconciler";
import { SecretsStore, SecretsStoreLive } from "@/lib/secrets-store";

const ACCOUNT = "reconcile-e2e.near";
const GATEWAY = "e2e.dev.everything.dev";
const INSTANCE = instanceNameFor({ account: ACCOUNT, gateway: GATEWAY });
const CONTAINER = `bos-hosting-${INSTANCE}`;

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const haveDocker = dockerAvailable();

function dockerInspect(name: string, format: string): string {
  return execFileSync("docker", ["inspect", "-f", format, name], { stdio: "pipe" }).toString();
}

function removeContainer(name: string): void {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {
    // nothing to clean up
  }
}

const stateDir = mkdtempSync(join(tmpdir(), "bos-reconciler-e2e-"));

const REF = runtimeRefOf({ accountId: ACCOUNT, gatewayId: GATEWAY });
const IMAGE_REF = "nginx";
const REGISTRY_URL = "https://kv.example.test/v0/latest/ns/ns/bos.config.json";

let records: Array<{ key: string; blockHeight: number; blockTimestampNs: string; value: unknown }> =
  [];
let configEntries: RegistryHistoryEntry[] = [];
let tagEntries: RegistryHistoryEntry[] = [];
const versionRecords = new Map<string, unknown>();

const source: DeployHistorySource = {
  listDeployRecords: async () => records,
  keyHistory: async (key) => (key.kind === "manifest" ? tagEntries : configEntries),
  readVersionRecord: async (key) =>
    key.kind === "version" ? (versionRecords.get(key.version) ?? null) : null,
};

const versionRecordFixture = (version: string, tag: string) =>
  ManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: version,
    everyPluginVersion: "0.19.2",
    image: { ref: IMAGE_REF, tags: [tag] },
    catalog: {},
    sharedDeps: {},
    templateInventory: [],
    compat: { minChild: "2.0.0-rc.37" },
  });

const publish = (sequence: number, configSlot: string, imageTag: string): void => {
  const block = 100 + sequence;
  const publishedAt = `2026-10-22T00:${String(sequence).padStart(2, "0")}:00.000Z`;
  const version = `2.0.0-rc.${sequence}`;
  records = [
    {
      key: keyPathOf({ kind: "deployRecord", ref: REF, ts: deployRecordTsOf(publishedAt) }),
      blockHeight: block,
      blockTimestampNs: String(block),
      value: DeployRecordSchema.parse({
        account: ACCOUNT,
        gateway: GATEWAY,
        network: "mainnet",
        publishedAt,
        registryUrl: REGISTRY_URL,
        platformManifest: {
          version,
          tag: keyPathOf({ kind: "manifest", ref: REF }),
          tagIntegrity: "sha384-tag",
          record: keyPathOf({ kind: "version", ref: REF, version }),
          integrity: "sha384-record",
        },
      }),
    },
  ];
  configEntries = [
    {
      blockHeight: block,
      blockTimestampNs: String(block),
      value: { plugins: { votes: configSlot } },
    },
  ];
  tagEntries = [
    {
      blockHeight: block,
      blockTimestampNs: String(block),
      value: ManifestTagSchema.parse({
        schemaVersion: 1,
        version,
        digest: "4d5c80037cc00a8b663b83146d65fd5e6c3686b46ab7efdf0970aad04f6042ba",
      }),
    },
  ];
  versionRecords.set(version, versionRecordFixture(version, imageTag));
};

describe.skipIf(!haveDocker)("reconciler converges a docker instance on publish", () => {
  let runtime:
    | ManagedRuntime.ManagedRuntime<HostingAdapter | DeployHistoryService | SecretsStore, never>
    | undefined;

  beforeAll(async () => {
    removeContainer(CONTAINER);
    runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Layer.succeed(
          DeployHistoryService,
          DeployHistoryService.of(buildDeployHistoryService(source)),
        ),
        dockerHostingAdapterLayer({
          containerPort: 80,
          healthPath: "/",
          healthTimeout: "60 seconds",
          stateDir,
          stage: "test",
        }),
        SecretsStoreLive("e2e-reconciler-root").pipe(
          Layer.provideMerge(
            DatabaseLive({
              pluginId: "reconciler-e2e",
              secrets: { API_DATABASE_URL: "pglite::memory:" },
            }),
          ),
          Layer.orDie,
        ),
      ),
    );
  }, 120_000);

  afterAll(async () => {
    await runtime?.dispose();
    removeContainer(CONTAINER);
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("a publish converges the container with no manual action", async () => {
    if (!runtime) throw new Error("runtime not booted");
    const adapter = await runtime.runPromise(HostingAdapter);
    const history = await runtime.runPromise(DeployHistoryService);
    const store = await runtime.runPromise(SecretsStore);

    publish(1, "v1", "alpine");
    const reconciler = buildReconciler(
      { history, secrets: store, adapter, provisionDatabases: undefined },
      { watch: [{ account: ACCOUNT, gateway: GATEWAY }], pollIntervalMs: 15000 },
    );

    const first = (await runtime.runPromise(reconciler.tick())) as ReconcilerStatusSnapshot;
    expect(first.namespaces[0]).toMatchObject({
      convergedDigest: expect.any(String),
      bootAssumed: false,
    });
    expect(dockerInspect(CONTAINER, "{{.Config.Image}}")).toContain("nginx:alpine");

    await runtime.runPromise(
      store.set({ account: ACCOUNT, gateway: GATEWAY, name: "AI_API_KEY", value: "sk-from-vault" }),
    );
    publish(2, "v2", "1.27-alpine");

    const second = await runtime.runPromise(reconciler.tick());
    expect(second.namespaces[0]).toMatchObject({ convergedDigest: expect.any(String) });
    expect(dockerInspect(CONTAINER, "{{.Config.Image}}")).toContain("nginx:1.27-alpine");
    const env = dockerInspect(CONTAINER, "{{json .Config.Env}}");
    expect(env).toContain("AI_API_KEY=sk-from-vault");
    expect(env).toContain(`BOS_ACCOUNT=${ACCOUNT}`);
    expect(env).toContain(`BOS_GATEWAY=${GATEWAY}`);

    const third = await runtime.runPromise(reconciler.tick());
    expect(third.namespaces[0]?.drift).toBeUndefined();
  }, 180_000);
});
