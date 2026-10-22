import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostingAdapter, type RuntimeDescriptor } from "../../src/services/hosting/adapter";
import { dockerHostingAdapterLayer } from "../../src/services/hosting/docker";
import { descriptorRuntime, withSecrets } from "../../src/services/hosting/secrets";

const TEST_IMAGE = "nginx:alpine";
const TEST_INSTANCE = `hosting-secrets-test-${process.pid}`;
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

function dockerInspectEnv(name: string): string {
  return execFileSync("docker", ["inspect", "-f", "{{json .Config.Env}}", name], {
    stdio: "pipe",
  }).toString();
}

function removeContainer(name: string): void {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
  } catch {
    // nothing to clean up
  }
}

const stateDir = mkdtempSync(join(tmpdir(), "bos-hosting-secrets-"));

describe("withSecrets (pure)", () => {
  const descriptor: RuntimeDescriptor = {
    instance: "pure-test",
    image: TEST_IMAGE,
    identityEnv: { BOS_ACCOUNT: "runtime.near", BOS_GATEWAY: "runtime.dev" },
  };

  it("reads the runtime identity the descriptor carries", () => {
    expect(descriptorRuntime(descriptor)).toEqual({
      account: "runtime.near",
      gateway: "runtime.dev",
    });
  });

  it("merges stored secrets under the platform-composed identity keys", () => {
    const merged = withSecrets(descriptor, {
      AI_API_KEY: "sk-vault-test",
      BOS_ACCOUNT: "spoof-attempt.near",
    });
    expect(merged.identityEnv.BOS_ACCOUNT).toBe("runtime.near");
    expect(merged.identityEnv.AI_API_KEY).toBe("sk-vault-test");
    expect(merged.identityEnv.BOS_GATEWAY).toBe("runtime.dev");
  });
});

describe.skipIf(!haveDocker)("secrets delivery into a docker instance", () => {
  let runtime: ManagedRuntime.ManagedRuntime<HostingAdapter, never>;

  const baseDescriptor: RuntimeDescriptor = {
    instance: TEST_INSTANCE,
    image: TEST_IMAGE,
    identityEnv: { BOS_ACCOUNT: "vaulted.near", BOS_GATEWAY: "vaulted.dev" },
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
  }, 120_000);

  afterAll(async () => {
    await runtime?.dispose();
    removeContainer(CONTAINER);
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("a deployed instance receives the vault's resolved secrets via identityEnv", async () => {
    const adapter = await runtime.runPromise(HostingAdapter);

    const stored: Record<string, string> = {
      AI_API_KEY: "sk-from-vault",
      SMTP_PASSWORD: "hunter2",
    };

    const deployed = await runtime.runPromise(adapter.deploy(withSecrets(baseDescriptor, stored)));
    expect(deployed.instance).toBe(TEST_INSTANCE);

    const env = dockerInspectEnv(CONTAINER);
    expect(env).toContain("AI_API_KEY=sk-from-vault");
    expect(env).toContain("SMTP_PASSWORD=hunter2");
    expect(env).toContain("BOS_ACCOUNT=vaulted.near");
    expect(env).toContain("BOS_GATEWAY=vaulted.dev");
  }, 120_000);
});
