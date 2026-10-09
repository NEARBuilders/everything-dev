import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("../../src/utils/run", () => ({ run: runMock }));

import {
  buildAndPushImage,
  computeImageTags,
  deployImageToRailway,
  isValidImageDigest,
  resolveDeployImagePlan,
  resolveImageRef,
} from "../../src/image-deploy";

describe("resolveImageRef", () => {
  it("prefers ci.image from bos.config.json", () => {
    expect(
      resolveImageRef({
        ciImage: "ghcr.io/acme/tenant",
        repository: "https://github.com/acme/other",
        env: { BOS_IMAGE: "ghcr.io/from/env" },
      }),
    ).toEqual({ image: "ghcr.io/acme/tenant", source: "ci" });
  });

  it("falls back to BOS_IMAGE", () => {
    expect(
      resolveImageRef({
        repository: "https://github.com/acme/other",
        env: { BOS_IMAGE: "ghcr.io/from/env" },
      }),
    ).toEqual({ image: "ghcr.io/from/env", source: "env" });
  });

  it("derives ghcr.io/<owner>/<repo> from the repository URL", () => {
    expect(resolveImageRef({ repository: "https://github.com/NEARBuilders/citynode.app" })).toEqual(
      {
        image: "ghcr.io/nearbuilders/citynode.app",
        source: "repository",
      },
    );
  });

  it("returns undefined without a usable repository", () => {
    expect(resolveImageRef({})).toBeUndefined();
    expect(resolveImageRef({ repository: "https://gitlab.com/acme/app" })).toBeUndefined();
  });
});

describe("resolveDeployImagePlan", () => {
  const imageRef = { image: "ghcr.io/acme/app", source: "repository" as const };

  it("uses a pre-pushed digest without requiring docker or a Dockerfile", () => {
    expect(
      resolveDeployImagePlan({
        imageRef,
        imageDigest: "sha256:abc123",
        hasDocker: false,
        hasDockerfile: false,
      }),
    ).toEqual({ kind: "prebuilt", image: "ghcr.io/acme/app", digest: "sha256:abc123" });
  });

  it("skips when no image ref is resolvable", () => {
    const plan = resolveDeployImagePlan({
      imageRef: undefined,
      imageDigest: "sha256:abc123",
      hasDocker: true,
      hasDockerfile: true,
    });
    expect(plan.kind).toBe("skip");
    expect(plan.kind === "skip" && plan.reason).toContain("ci.image");
  });

  it("builds locally when docker and the Dockerfile are present", () => {
    expect(resolveDeployImagePlan({ imageRef, hasDocker: true, hasDockerfile: true })).toEqual({
      kind: "build",
      image: "ghcr.io/acme/app",
    });
  });

  it("skips when docker is unavailable and no digest was provided", () => {
    const plan = resolveDeployImagePlan({ imageRef, hasDocker: false, hasDockerfile: true });
    expect(plan.kind).toBe("skip");
    expect(plan.kind === "skip" && plan.reason).toContain("docker");
  });

  it("skips when the config root has no Dockerfile and no digest was provided", () => {
    const plan = resolveDeployImagePlan({ imageRef, hasDocker: true, hasDockerfile: false });
    expect(plan.kind).toBe("skip");
    expect(plan.kind === "skip" && plan.reason).toContain("Dockerfile");
  });

  it("treats an empty digest as absent", () => {
    expect(
      resolveDeployImagePlan({ imageRef, imageDigest: "", hasDocker: true, hasDockerfile: true }),
    ).toEqual({ kind: "build", image: "ghcr.io/acme/app" });
  });
});

describe("isValidImageDigest", () => {
  const digest64 = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("accepts sha256:<64 lowercase hex>", () => {
    expect(isValidImageDigest(digest64)).toBe(true);
  });

  it("rejects wrong prefixes, lengths, and characters", () => {
    expect(isValidImageDigest("sha256:abc123")).toBe(false);
    expect(isValidImageDigest("sha512:0123456789abcdef")).toBe(false);
    expect(isValidImageDigest(digest64.toUpperCase())).toBe(false);
    expect(isValidImageDigest(`${digest64}f`)).toBe(false);
    expect(isValidImageDigest("")).toBe(false);
  });
});

describe("computeImageTags", () => {
  it("always pins the sha tag", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13" })).toEqual({
      tags: ["sha-cf2ab4d13"],
      pushLatest: true,
    });
  });

  it("adds the exact prerelease tag and holds latest", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "2.0.0-rc.0" })).toEqual({
      tags: ["sha-cf2ab4d13", "v2.0.0-rc.0"],
      pushLatest: false,
      latestHoldReason: "v2.0.0-rc.0 is a prerelease — :latest still serves the last stable image",
    });
  });

  it("adds exact and floating major tags plus latest on stable releases", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "2.0.0" })).toEqual({
      tags: ["sha-cf2ab4d13", "v2.0.0", "v2"],
      pushLatest: true,
    });
  });

  it("keeps latest behavior for unknown versions", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "not-a-version" })).toEqual({
      tags: ["sha-cf2ab4d13"],
      pushLatest: true,
    });
  });
});

describe("buildAndPushImage", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-image-deploy-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function ok(stdout = "") {
    return { stdout, stderr: "", exitCode: 0 };
  }

  function writeWorkspaceVersion(version: string) {
    const pkgDir = join(configDir, "packages", "everything-dev");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version }));
  }

  it("builds the runtime stage with sha and latest tags and captures the digest", async () => {
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") return undefined;
      if (cmd === "docker" && args[0] === "push") {
        return ok(
          "The push refers to repository [ghcr.io/x/y]\nlatest: digest: sha256:abc123 size: 1571",
        );
      }
      return ok();
    });

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13"],
      latestPushed: true,
      digest: "sha256:abc123",
    });
    expect(runMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "--target",
        "runtime",
        "-t",
        "ghcr.io/acme/app:sha-cf2ab4d13",
        "-t",
        "ghcr.io/acme/app:latest",
        ".",
      ],
      { cwd: configDir },
    );
    const pushes = runMock.mock.calls.filter((c) => c[0] === "docker" && c[1][0] === "push");
    expect(pushes.map((c) => c[1][1])).toEqual([
      "ghcr.io/acme/app:sha-cf2ab4d13",
      "ghcr.io/acme/app:latest",
    ]);
  });

  it("holds latest and pushes the exact tag for a prerelease workspace version", async () => {
    writeWorkspaceVersion("2.0.0-rc.0");
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") return undefined;
      if (cmd === "docker" && args[0] === "push") {
        return ok("digest: sha256:def456");
      }
      return ok();
    });

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13", "v2.0.0-rc.0"],
      latestPushed: false,
      digest: "sha256:def456",
    });
    expect(runMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "--target",
        "runtime",
        "-t",
        "ghcr.io/acme/app:sha-cf2ab4d13",
        "-t",
        "ghcr.io/acme/app:v2.0.0-rc.0",
        ".",
      ],
      { cwd: configDir },
    );
    const pushes = runMock.mock.calls.filter((c) => c[0] === "docker" && c[1][0] === "push");
    expect(pushes.map((c) => c[1][1])).toEqual([
      "ghcr.io/acme/app:sha-cf2ab4d13",
      "ghcr.io/acme/app:v2.0.0-rc.0",
    ]);
  });

  it("pushes exact, major, and latest tags for a stable workspace version", async () => {
    writeWorkspaceVersion("2.0.0");
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") return undefined;
      if (cmd === "docker" && args[0] === "push") {
        return ok("digest: sha256:fa7891");
      }
      return ok();
    });

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13", "v2.0.0", "v2"],
      latestPushed: true,
      digest: "sha256:fa7891",
    });
    const pushes = runMock.mock.calls.filter((c) => c[0] === "docker" && c[1][0] === "push");
    expect(pushes.map((c) => c[1][1])).toEqual([
      "ghcr.io/acme/app:sha-cf2ab4d13",
      "ghcr.io/acme/app:v2.0.0",
      "ghcr.io/acme/app:v2",
      "ghcr.io/acme/app:latest",
    ]);
  });

  it("throws when the build fails", async () => {
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") {
        throw new Error("docker build ... failed with exit code 1");
      }
      return ok();
    });

    await expect(buildAndPushImage({ image: "ghcr.io/acme/app", configDir })).rejects.toThrow(
      /docker build/,
    );
  });
});

describe("deployImageToRailway", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-railway-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("writes the thin digest-pinned Dockerfile and runs railway up against it", async () => {
    runMock.mockResolvedValue({ stdout: "Deployed", stderr: "", exitCode: 0 });

    await deployImageToRailway({
      image: "ghcr.io/acme/app",
      digest: "sha256:abc123",
      service: "app",
      configDir,
    });

    expect(readFileSync(join(configDir, ".bos", "deploy", "Dockerfile"), "utf-8")).toBe(
      "FROM ghcr.io/acme/app@sha256:abc123\n",
    );
    expect(runMock).toHaveBeenCalledWith("railway", ["up", "--service", "app", "--ci"], {
      cwd: configDir,
      capture: true,
      env: { RAILWAY_DOCKERFILE_PATH: ".bos/deploy/Dockerfile" },
    });
  });

  it("throws with stderr detail when railway up fails", async () => {
    runMock.mockResolvedValue({ stdout: "", stderr: "service not found", exitCode: 1 });

    await expect(
      deployImageToRailway({
        image: "ghcr.io/acme/app",
        digest: "sha256:abc123",
        service: "app",
        configDir,
      }),
    ).rejects.toThrow("service not found");
  });
});
