import { describe, expect, it } from "vitest";

import { resolveImageLegPlan, resolveRailwayLeg, resolveRuntimeTier } from "../../src/deploy-legs";

describe("resolveRuntimeTier", () => {
  it("is root when ci.image is configured", () => {
    expect(
      resolveRuntimeTier({ ciImage: "ghcr.io/nearbuilders/everything-dev", hasDockerfile: false }),
    ).toBe("root");
  });

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
    expect(resolveRuntimeTier({ ciImage: "", hasDockerfile: false })).toBe("child");
  });
});

describe("resolveImageLegPlan", () => {
  const imageRef = { image: "ghcr.io/nearbuilders/everything-dev", source: "repository" as const };

  it("pins a pre-pushed digest regardless of tier — the digest is an explicit handover", () => {
    expect(
      resolveImageLegPlan({
        tier: "child",
        imageRef,
        imageDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        hasDocker: false,
        hasDockerfile: false,
      }),
    ).toEqual({
      kind: "prebuilt",
      image: "ghcr.io/nearbuilders/everything-dev",
      digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
  });

  it("skips for a child runtime without probing docker or the Dockerfile", () => {
    const plan = resolveImageLegPlan({
      tier: "child",
      imageRef,
      hasDocker: false,
      hasDockerfile: false,
    });
    expect(plan.kind).toBe("skip");
    expect(plan.kind === "skip" && plan.reason).toContain("inherits");
  });

  it("delegates to the existing plan for a root runtime", () => {
    expect(
      resolveImageLegPlan({ tier: "root", imageRef, hasDocker: true, hasDockerfile: true }),
    ).toEqual({ kind: "build", image: "ghcr.io/nearbuilders/everything-dev" });
    const plan = resolveImageLegPlan({
      tier: "root",
      imageRef: undefined,
      hasDocker: true,
      hasDockerfile: true,
    });
    expect(plan.kind).toBe("skip");
    expect(plan.kind === "skip" && plan.reason).toContain("ci.image");
  });
});

describe("resolveRailwayLeg", () => {
  it("skips when no RAILWAY_TOKEN is set, in either tier", () => {
    for (const tier of ["root", "child"] as const) {
      const decision = resolveRailwayLeg({ tier, railwayToken: undefined, service: "app" });
      expect(decision.action).toBe("skip");
      expect(decision.outcome?.status).toBe("skipped");
      expect(decision.outcome?.detail).toContain("RAILWAY_TOKEN");
    }
  });

  it("fails for a root runtime with a token but no configured service", () => {
    const decision = resolveRailwayLeg({ tier: "root", railwayToken: "token", service: undefined });
    expect(decision.action).toBe("skip");
    expect(decision.outcome?.status).toBe("failed");
    expect(decision.outcome?.detail).toContain("ci.railway.service");
  });

  it("soft-skips for a child runtime with a token but no configured service", () => {
    const decision = resolveRailwayLeg({
      tier: "child",
      railwayToken: "token",
      service: undefined,
    });
    expect(decision.action).toBe("skip");
    expect(decision.outcome?.status).toBe("skipped");
    expect(decision.outcome?.detail).toContain("ci.railway.service");
  });

  it("fails for a root runtime with a service but no digest — the train must pin its bytes", () => {
    const decision = resolveRailwayLeg({
      tier: "root",
      railwayToken: "token",
      service: "app",
      digest: undefined,
    });
    expect(decision.action).toBe("skip");
    expect(decision.outcome?.status).toBe("failed");
    expect(decision.outcome?.detail).toContain("ci.image");
  });

  it("redeploys for a child runtime with a service without requiring a digest (ADR 0021)", () => {
    const decision = resolveRailwayLeg({
      tier: "child",
      railwayToken: "token",
      service: "app",
      digest: undefined,
    });
    expect(decision.action).toBe("redeploy");
    expect(decision.outcome).toBeUndefined();
  });

  it("redeploys in either tier when a digest pins the image", () => {
    for (const tier of ["root", "child"] as const) {
      const decision = resolveRailwayLeg({
        tier,
        railwayToken: "token",
        service: "app",
        digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });
      expect(decision.action).toBe("redeploy");
      expect(decision.outcome).toBeUndefined();
    }
  });
});
