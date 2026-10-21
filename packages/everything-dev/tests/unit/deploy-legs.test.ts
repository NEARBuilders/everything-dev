import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ChildImagePin,
  resolveChildImagePin,
  resolveDeployPlan,
  resolveRailwayStep,
  resolveRuntimeTier,
  runPostPublishLegs,
} from "../../src/services/deploy/legs";

const digest64 = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const imageRef = { image: "ghcr.io/nearbuilders/everything-dev", source: "repository" as const };
const pin: ChildImagePin = {
  image: "ghcr.io/nearbuilders/everything-dev",
  tag: "v2.0.0-rc.14",
  digest: digest64,
};

describe("resolveRuntimeTier", () => {
  it("is root when BOS_IMAGE names an image", () => {
    expect(resolveRuntimeTier({ imageEnv: "ghcr.io/acme/runtime", hasDockerfile: false })).toBe(
      "root",
    );
  });

  it("is root when a Dockerfile exists at the config root", () => {
    expect(resolveRuntimeTier({ hasDockerfile: true })).toBe("root");
  });

  it("is child when the train cannot produce an image (ADR 0020/0021)", () => {
    expect(resolveRuntimeTier({ hasDockerfile: false })).toBe("child");
    expect(resolveRuntimeTier({ imageEnv: "", hasDockerfile: false })).toBe("child");
  });
});

describe("resolveDeployPlan", () => {
  it("prebuilt: an explicit digest handover wins over the tier, any tier", () => {
    for (const tier of ["root", "child"] as const) {
      expect(
        resolveDeployPlan({
          tier,
          childPin: pin,
          imageRef,
          digestHandover: digest64,
          hasDocker: false,
          hasDockerfile: false,
        }).image,
      ).toEqual({ action: "prebuilt", image: imageRef.image, digest: digest64 });
    }
  });

  it("pinned: a child with a platform pin resolves to the manifest ref without producing bytes", () => {
    expect(
      resolveDeployPlan({
        tier: "child",
        childPin: pin,
        imageRef,
        hasDocker: false,
        hasDockerfile: false,
      }).image,
    ).toEqual({ action: "pinned", image: pin.image, tag: pin.tag, digest: digest64 });
  });

  it("skip: a float child inherits the universal image without probing docker or the Dockerfile", () => {
    const plan = resolveDeployPlan({
      tier: "child",
      imageRef,
      hasDocker: false,
      hasDockerfile: false,
    });
    expect(plan.image.action).toBe("skip");
    expect(plan.image.action === "skip" && plan.image.reason).toContain("inherits");
  });

  it("build: a root runtime with docker and a Dockerfile builds", () => {
    expect(
      resolveDeployPlan({
        tier: "root",
        imageRef,
        hasDocker: true,
        hasDockerfile: true,
      }).image,
    ).toEqual({ action: "build", image: imageRef.image });
  });

  it("skip: a root runtime without an image ref, docker, or a Dockerfile", () => {
    const noRef = resolveDeployPlan({
      tier: "root",
      imageRef: undefined,
      hasDocker: true,
      hasDockerfile: true,
    });
    expect(noRef.image.action === "skip" && noRef.image.reason).toContain("BOS_IMAGE");

    const noDocker = resolveDeployPlan({
      tier: "root",
      imageRef,
      hasDocker: false,
      hasDockerfile: true,
    });
    expect(noDocker.image.action === "skip" && noDocker.image.reason).toContain("docker");

    const noDockerfile = resolveDeployPlan({
      tier: "root",
      imageRef,
      hasDocker: true,
      hasDockerfile: false,
    });
    expect(noDockerfile.image.action === "skip" && noDockerfile.image.reason).toContain(
      "Dockerfile",
    );
  });

  it("smoke boots a precomputed digest ref for pinned and prebuilt images", () => {
    const pinnedPlan = resolveDeployPlan({
      tier: "child",
      childPin: pin,
      imageRef,
      hasDocker: false,
      hasDockerfile: false,
      smokeRequested: true,
    });
    expect(pinnedPlan.smoke).toEqual({
      action: "boot",
      image: imageRef.image,
      ref: `${imageRef.image}@${digest64}`,
    });

    const prebuiltPlan = resolveDeployPlan({
      tier: "root",
      imageRef,
      digestHandover: digest64,
      hasDocker: false,
      hasDockerfile: false,
      smokeRequested: true,
    });
    expect(prebuiltPlan.smoke).toEqual({
      action: "boot",
      image: imageRef.image,
      ref: `${imageRef.image}@${digest64}`,
    });
  });

  it("smoke for a build boots the captured digest at execution time — no ref precomputed", () => {
    const plan = resolveDeployPlan({
      tier: "root",
      imageRef,
      hasDocker: true,
      hasDockerfile: true,
      smokeRequested: true,
    });
    expect(plan.smoke).toEqual({ action: "boot", image: imageRef.image });
  });

  it("smoke skips with a tier-specific reason when no digest can exist", () => {
    const floatChild = resolveDeployPlan({
      tier: "child",
      imageRef,
      hasDocker: false,
      hasDockerfile: false,
      smokeRequested: true,
    });
    expect(floatChild.smoke).toEqual({
      action: "skip",
      reason: expect.stringContaining("inherits the root's universal image"),
    });

    const rootNoDigest = resolveDeployPlan({
      tier: "root",
      imageRef: undefined,
      hasDocker: true,
      hasDockerfile: true,
      smokeRequested: true,
    });
    expect(rootNoDigest.smoke).toEqual({
      action: "skip",
      reason: expect.stringContaining("BOS_IMAGE_DIGEST"),
    });
  });

  it("omits the smoke step entirely when smoke was not requested", () => {
    const plan = resolveDeployPlan({
      tier: "child",
      childPin: pin,
      imageRef,
      hasDocker: false,
      hasDockerfile: false,
    });
    expect(plan.smoke).toBeUndefined();
  });
});

describe("resolveRailwayStep", () => {
  it("skips when no RAILWAY_TOKEN is set, in either tier", () => {
    for (const tier of ["root", "child"] as const) {
      const step = resolveRailwayStep({ tier, token: undefined, service: "app" });
      expect(step.action).toBe("skip");
      expect(step.action === "skip" && step.detail).toContain("RAILWAY_TOKEN");
    }
  });

  it("fails for a root runtime with a token but no configured service", () => {
    const step = resolveRailwayStep({ tier: "root", token: "token", service: undefined });
    expect(step.action).toBe("fail");
    expect(step.action === "fail" && step.detail).toContain("ci.railway.service");
  });

  it("soft-skips for a child runtime with a token but no configured service", () => {
    const step = resolveRailwayStep({ tier: "child", token: "token", service: undefined });
    expect(step.action).toBe("skip");
    expect(step.action === "skip" && step.detail).toContain("ci.railway.service");
  });

  it("fails for a root runtime with a service but no pinned digest — the train must pin its bytes", () => {
    const step = resolveRailwayStep({
      tier: "root",
      token: "token",
      service: "app",
      pinnedDigest: undefined,
    });
    expect(step.action).toBe("fail");
    expect(step.action === "fail" && step.detail).toContain("BOS_IMAGE_DIGEST");
  });

  it("redeploys for a float child without requiring a digest (ADR 0021)", () => {
    expect(resolveRailwayStep({ tier: "child", token: "token", service: "app" })).toEqual({
      action: "redeploy",
      service: "app",
    });
  });

  it("repoints-and-redeploys for a pinned child — the service source follows the pin", () => {
    expect(
      resolveRailwayStep({
        tier: "child",
        token: "token",
        service: "app",
        pinnedDigest: digest64,
        childPin: pin,
      }),
    ).toEqual({
      action: "repoint-and-redeploy",
      service: "app",
      image: `${pin.image}:${pin.tag}`,
    });
  });

  it("redeploys in either tier when a digest pins the image", () => {
    for (const tier of ["root", "child"] as const) {
      expect(
        resolveRailwayStep({
          tier,
          token: "token",
          service: "app",
          pinnedDigest: digest64,
        }).action,
      ).toBe("redeploy");
    }
  });
});

describe("resolveChildImagePin", () => {
  const manifest = {
    frameworkVersion: "2.0.0-rc.14",
    image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: ["v2.0.0-rc.14"] },
  };

  it("resolves the manifest's ref:tag and the registry digest", async () => {
    const resolved = await resolveChildImagePin({
      configDir: mkdtempSync(join(tmpdir(), "bos-child-pin-")),
      localConfig: { extends: "bos://acct/gateway" },
      fetchManifest: async () => manifest as never,
      fetchDigest: async ({ ref }) => {
        expect(ref).toBe("ghcr.io/nearbuilders/everything-dev:v2.0.0-rc.14");
        return digest64;
      },
    });
    expect(resolved).toEqual({
      image: "ghcr.io/nearbuilders/everything-dev",
      tag: "v2.0.0-rc.14",
      digest: digest64,
    });
  });

  it("is undefined when no manifest resolves — the float-redeploy fallback", async () => {
    const resolved = await resolveChildImagePin({
      configDir: mkdtempSync(join(tmpdir(), "bos-child-pin-")),
      localConfig: { extends: "bos://acct/gateway" },
      fetchManifest: async () => null,
    });
    expect(resolved).toBeUndefined();
  });

  it("fails loudly when a pin is recorded but no matching manifest resolves", async () => {
    await expect(
      resolveChildImagePin({
        configDir: mkdtempSync(join(tmpdir(), "bos-child-pin-")),
        localConfig: { extends: "bos://acct/gateway", platform: "9.9.9" },
        fetchManifest: async () => manifest as never,
      }),
    ).rejects.toThrow(/platform pin 9\.9\.9 not found/);
  });
});

describe("runPostPublishLegs", () => {
  let sessionRoot: string | undefined;

  afterEach(() => {
    if (sessionRoot) rmSync(sessionRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  function baseDeps() {
    return {
      buildAndPushImage: vi.fn(),
      hasDocker: vi.fn().mockResolvedValue(false),
      runSmoke: vi.fn().mockResolvedValue({ ok: true, image: "x", summary: "boot ok" }),
      deployImageToRailway: vi.fn().mockResolvedValue(undefined),
      repointServiceSource: vi.fn().mockResolvedValue(undefined),
      resolveChildImagePin: vi.fn().mockResolvedValue(undefined),
      rollbackToPreviousSnapshot: vi.fn(),
    };
  }

  it("pinned child: pins the manifest ref, boots the digest, repoints the service before the redeploy", async () => {
    sessionRoot = mkdtempSync(join(tmpdir(), "bos-legs-pin-"));
    vi.stubEnv("RAILWAY_TOKEN", "token");
    vi.stubEnv("BOS_IMAGE", "");
    const deps = { ...baseDeps(), resolveChildImagePin: vi.fn().mockResolvedValue(pin) };

    const outcome = await runPostPublishLegs(
      {
        sessionRoot,
        env: "production",
        smoke: true,
        railwayService: "app",
        runtimeConfig: null,
        account: "acct",
        domain: "gw",
        localConfig: { extends: "bos://acct/gateway" },
      },
      deps,
    );

    expect(outcome.failure).toBeUndefined();
    expect(outcome.image).toBe(pin.image);
    expect(outcome.imageDigest).toBe(digest64);
    expect(outcome.legs.image?.status).toBe("ok");
    expect(outcome.legs.image?.detail).toContain(`pinned ${pin.image}:${pin.tag}`);
    expect(deps.buildAndPushImage).not.toHaveBeenCalled();
    expect(deps.runSmoke).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `${pin.image}@${digest64}`,
        account: "acct",
        gateway: "gw",
      }),
    );
    expect(deps.repointServiceSource).toHaveBeenCalledWith({
      service: "app",
      image: `${pin.image}:${pin.tag}`,
      configDir: sessionRoot,
    });
    expect(deps.deployImageToRailway).toHaveBeenCalledWith({
      service: "app",
      configDir: sessionRoot,
    });
    expect(outcome.legs.railway?.detail).toBe(`pinned ${pin.image}:${pin.tag}, redeployed app`);
  });

  it("fails before any leg when the pin cannot resolve", async () => {
    sessionRoot = mkdtempSync(join(tmpdir(), "bos-legs-pin-fail-"));
    vi.stubEnv("BOS_IMAGE", "");
    const deps = {
      ...baseDeps(),
      resolveChildImagePin: vi.fn().mockRejectedValue(new Error("the registry has no manifest")),
    };

    const outcome = await runPostPublishLegs(
      { sessionRoot, env: "production", smoke: true, railwayService: "app", runtimeConfig: null },
      deps,
    );

    expect(outcome.failure).toContain("Image pin failed");
    expect(outcome.legs.image?.status).toBe("failed");
    expect(deps.deployImageToRailway).not.toHaveBeenCalled();
    expect(deps.runSmoke).not.toHaveBeenCalled();
  });

  it("float child: skips the image leg, blind redeploy, no repoint", async () => {
    sessionRoot = mkdtempSync(join(tmpdir(), "bos-legs-float-"));
    vi.stubEnv("RAILWAY_TOKEN", "token");
    vi.stubEnv("BOS_IMAGE", "");
    const deps = baseDeps();

    const outcome = await runPostPublishLegs(
      {
        sessionRoot,
        env: "production",
        smoke: true,
        railwayService: "app",
        runtimeConfig: null,
      },
      deps,
    );

    expect(outcome.legs.image?.status).toBe("skipped");
    expect(outcome.legs.smoke?.status).toBe("skipped");
    expect(deps.repointServiceSource).not.toHaveBeenCalled();
    expect(deps.deployImageToRailway).toHaveBeenCalledWith({
      service: "app",
      configDir: sessionRoot,
    });
    expect(outcome.legs.railway?.detail).toBe("redeployed app");
  });

  it("root: keeps the prebuilt path — no pin resolution, no repoint", async () => {
    sessionRoot = mkdtempSync(join(tmpdir(), "bos-legs-root-"));
    writeFileSync(join(sessionRoot, "Dockerfile"), "FROM scratch");
    vi.stubEnv("RAILWAY_TOKEN", "token");
    vi.stubEnv("BOS_IMAGE", "");
    const deps = baseDeps();

    const outcome = await runPostPublishLegs(
      {
        sessionRoot,
        env: "production",
        smoke: true,
        imageDigestInput: digest64,
        railwayService: "app",
        runtimeConfig: null,
        account: "acct",
        domain: "gw",
        repository: "https://github.com/NEARBuilders/everything-dev",
      },
      deps,
    );

    expect(deps.resolveChildImagePin).not.toHaveBeenCalled();
    expect(deps.repointServiceSource).not.toHaveBeenCalled();
    expect(outcome.legs.image?.status).toBe("ok");
    expect(outcome.legs.image?.detail).toContain("pre-pushed");
    expect(deps.runSmoke).toHaveBeenCalledWith(
      expect.objectContaining({ image: `ghcr.io/nearbuilders/everything-dev@${digest64}` }),
    );
    expect(deps.deployImageToRailway).toHaveBeenCalled();
  });
});
