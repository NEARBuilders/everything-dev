import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HostingAdapter } from "everything-dev/hosting";
import { dockerHostingAdapterLayer } from "everything-dev/hosting/docker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseLive } from "@/db/layer";
import {
  buildDeployHistoryService,
  DeployHistoryService,
  type RegistryHistoryEntry,
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

let manifests: RegistryHistoryEntry[] = [];
let configs: RegistryHistoryEntry[] = [];
let platforms: RegistryHistoryEntry[] = [];

const fetchJson = (url: string, init?: RequestInit): Promise<unknown> => {
  const body = init?.body ? (JSON.parse(init.body as string) as { key_prefix?: string }) : null;
  if (body?.key_prefix?.includes("/manifests/")) {
    return Promise.resolve({ entries: manifests });
  }
  if (url.includes("platform.json")) return Promise.resolve({ entries: platforms });
  return Promise.resolve({ entries: configs });
};

const publish = (sequence: number, configSlot: string, imageRef: string): void => {
  const block = 100 + sequence;
  const publishedAt = `2026-10-22T00:${String(sequence).padStart(2, "0")}:00.000Z`;
  manifests = [
    {
      key: `apps/${ACCOUNT}/${GATEWAY}/manifests/${publishedAt.replace(/[:.]/g, "-")}.json`,
      blockHeight: block,
      blockTimestampNs: block,
      value: JSON.stringify({
        account: ACCOUNT,
        gateway: GATEWAY,
        network: "mainnet",
        publishedAt,
        registryUrl: "https://cdn.example.com",
      }),
    },
  ];
  configs = [
    {
      blockHeight: block,
      blockTimestampNs: block,
      value: JSON.stringify({ plugins: { votes: configSlot } }),
    },
  ];
  platforms = [
    {
      blockHeight: block,
      blockTimestampNs: block,
      value: JSON.stringify({ image: { ref: imageRef, tags: [] } }),
    },
  ];
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
          DeployHistoryService.of(buildDeployHistoryService(fetchJson)),
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

    publish(1, "v1", "nginx:alpine");
    const reconciler = buildReconciler(
      { history, secrets: store, adapter, provisionDatabases: undefined },
      { watch: [{ account: ACCOUNT, gateway: GATEWAY }], pollIntervalMs: 15000 },
    );

    const first = (await runtime.runPromise(reconciler.tick())) as ReconcilerStatusSnapshot;
    expect(first.namespaces[0]).toMatchObject({
      convergedFingerprint: expect.any(String),
      bootAssumed: false,
    });
    expect(dockerInspect(CONTAINER, "{{.Config.Image}}")).toContain("nginx:alpine");

    await runtime.runPromise(
      store.set({ account: ACCOUNT, gateway: GATEWAY, name: "AI_API_KEY", value: "sk-from-vault" }),
    );
    publish(2, "v2", "nginx:1.27-alpine");

    const second = await runtime.runPromise(reconciler.tick());
    expect(second.namespaces[0]).toMatchObject({ convergedFingerprint: expect.any(String) });
    expect(dockerInspect(CONTAINER, "{{.Config.Image}}")).toContain("nginx:1.27-alpine");
    const env = dockerInspect(CONTAINER, "{{json .Config.Env}}");
    expect(env).toContain("AI_API_KEY=sk-from-vault");
    expect(env).toContain(`BOS_ACCOUNT=${ACCOUNT}`);
    expect(env).toContain(`BOS_GATEWAY=${GATEWAY}`);

    const third = await runtime.runPromise(reconciler.tick());
    expect(third.namespaces[0]?.drift).toBeUndefined();
  }, 180_000);
});
