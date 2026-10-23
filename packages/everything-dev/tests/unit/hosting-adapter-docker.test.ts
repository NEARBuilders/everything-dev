import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HostingAdapter,
  type HostingAdapterService,
  type RuntimeDescriptor,
} from "../../src/services/hosting/adapter";
import { dockerHostingAdapterLayer } from "../../src/services/hosting/docker";

const TEST_IMAGE = "nginx:alpine";
const TEST_INSTANCE = `hosting-adapter-test-${process.pid}`;
const CONTAINER = `bos-hosting-${TEST_INSTANCE}`;

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const haveDocker = dockerAvailable();

function dockerInspectField(field: string, name: string): string {
  return execFileSync("docker", ["inspect", "-f", field, name], { stdio: "pipe" })
    .toString()
    .trim();
}

function removeContainer(name: string): void {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {
    // nothing to clean up
  }
}

const stateDir = mkdtempSync(join(tmpdir(), "bos-hosting-adapter-"));

describe.skipIf(!haveDocker)("DockerHostingAdapter", () => {
  let runtime: ManagedRuntime.ManagedRuntime<HostingAdapter, never>;
  let adapter: HostingAdapterService;

  const descriptor: RuntimeDescriptor = {
    instance: TEST_INSTANCE,
    image: TEST_IMAGE,
    identityEnv: { BOS_ACCOUNT: "adapter-test.near", BOS_GATEWAY: "adapter-test-gateway" },
  };

  beforeAll(async () => {
    removeContainer(CONTAINER);
    runtime = ManagedRuntime.make(
      dockerHostingAdapterLayer({
        containerPort: 80,
        healthPath: "/",
        healthTimeout: "30 seconds",
        stateDir,
        stage: "test",
      }),
    );
    adapter = await runtime.runPromise(HostingAdapter);
  }, 120_000);

  afterAll(async () => {
    await runtime?.dispose();
    removeContainer(CONTAINER);
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("deploys a scratch runtime, forwards identity env verbatim, and serves traffic on the returned URL", async () => {
    const deployed = await runtime.runPromise(adapter.deploy(descriptor));
    expect(deployed.instance).toBe(TEST_INSTANCE);
    expect(deployed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(`${deployed.url}/`);
    expect(response.status).toBe(200);

    const env = dockerInspectField("{{json .Config.Env}}", CONTAINER);
    expect(env).toContain("BOS_ACCOUNT=adapter-test.near");
    expect(env).toContain("BOS_GATEWAY=adapter-test-gateway");

    const snapshot = await runtime.runPromise(adapter.current(TEST_INSTANCE));
    expect(snapshot.running).toBe(true);
    expect(snapshot.url).toBe(deployed.url);
    expect(snapshot.image).toBe(TEST_IMAGE);
  }, 120_000);

  it("redeploys an unchanged descriptor idempotently without recreating the container", async () => {
    await runtime.runPromise(adapter.deploy(descriptor));
    const createdBefore = dockerInspectField("{{.Created}}", CONTAINER);

    const redeployed = await runtime.runPromise(adapter.deploy(descriptor));

    const createdAfter = dockerInspectField("{{.Created}}", CONTAINER);
    expect(createdAfter).toBe(createdBefore);
    expect(redeployed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${redeployed.url}/`);
    expect(response.status).toBe(200);
  }, 120_000);

  it("restarts a stopped instance and health-gates it back to serving", async () => {
    await runtime.runPromise(adapter.deploy(descriptor));
    await runtime.runPromise(adapter.stop(TEST_INSTANCE));

    const stopped = await runtime.runPromise(adapter.current(TEST_INSTANCE));
    expect(stopped.running).toBe(false);
    expect(stopped.url).toBeUndefined();

    const restarted = await runtime.runPromise(adapter.restart(TEST_INSTANCE));
    expect(restarted.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${restarted.url}/`);
    expect(response.status).toBe(200);
  }, 120_000);

  it("fails restart of a never-deployed instance with InstanceNotFound", async () => {
    const failure = await runtime.runPromise(
      adapter.restart("hosting-never-deployed").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("InstanceNotFound");
    expect(failure.instance).toBe("hosting-never-deployed");
  }, 60_000);

  it("fails stop of a never-deployed instance with InstanceNotFound", async () => {
    const failure = await runtime.runPromise(
      adapter.stop("hosting-never-deployed").pipe(Effect.flip),
    );
    expect(failure._tag).toBe("InstanceNotFound");
  }, 60_000);

  it("surfaces an unreachable health path as a typed HealthTimeout", async () => {
    const timeoutStateDir = mkdtempSync(join(tmpdir(), "bos-hosting-adapter-timeout-"));
    const timeoutRuntime = ManagedRuntime.make(
      dockerHostingAdapterLayer({
        containerPort: 80,
        healthPath: "/definitely-not-served",
        healthTimeout: "3 seconds",
        healthInterval: "250 millis",
        stateDir: timeoutStateDir,
        stage: "test",
      }),
    );
    try {
      const timeoutAdapter = await timeoutRuntime.runPromise(HostingAdapter);
      const failure = await timeoutRuntime.runPromise(
        timeoutAdapter
          .deploy({ ...descriptor, instance: `${TEST_INSTANCE}-timeout` })
          .pipe(Effect.flip),
      );
      if (failure._tag !== "HealthTimeout") {
        throw new Error(`expected HealthTimeout, got ${failure._tag}: ${failure.reason}`);
      }
      expect(failure.attempts).toBeGreaterThan(1);
      removeContainer(`bos-hosting-${TEST_INSTANCE}-timeout`);
    } finally {
      await timeoutRuntime.dispose();
      rmSync(timeoutStateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
