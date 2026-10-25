import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("../../src/utils/run", () => ({ run: runMock }));

import {
  buildAndPushImage,
  computeImageTags,
  deployImageToRailway,
  imageRefWithDigest,
  isValidImageDigest,
  parseRegistryRef,
  repointServiceSource,
  resolveDeployImagePlan,
  resolveImageRef,
  resolveRegistryDigest,
} from "../../src/services/deploy/image";

describe("resolveImageRef", () => {
  it("prefers BOS_IMAGE over the repository derivation", () => {
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

describe("imageRefWithDigest", () => {
  it("pins the digest so the boot cannot fall through to a held :latest", () => {
    expect(imageRefWithDigest("ghcr.io/acme/app", "sha256:03425986")).toBe(
      "ghcr.io/acme/app@sha256:03425986",
    );
  });

  it("passes the bare ref through without a digest", () => {
    expect(imageRefWithDigest("ghcr.io/acme/app")).toBe("ghcr.io/acme/app");
    expect(imageRefWithDigest("ghcr.io/acme/app", undefined)).toBe("ghcr.io/acme/app");
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
    expect(plan.kind === "skip" && plan.reason).toContain("BOS_IMAGE");
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
      pushRc: false,
    });
  });

  it("adds the exact prerelease tag, pushes rc, and holds latest", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "2.0.0-rc.0" })).toEqual({
      tags: ["sha-cf2ab4d13", "v2.0.0-rc.0"],
      pushLatest: false,
      latestHoldReason: "v2.0.0-rc.0 is a prerelease — :latest still serves the last stable image",
      pushRc: true,
    });
  });

  it("adds exact and floating major tags plus latest on stable releases", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "2.0.0" })).toEqual({
      tags: ["sha-cf2ab4d13", "v2.0.0", "v2"],
      pushLatest: true,
      pushRc: false,
    });
  });

  it("keeps latest behavior for unknown versions", () => {
    expect(computeImageTags({ shortSha: "cf2ab4d13", version: "not-a-version" })).toEqual({
      tags: ["sha-cf2ab4d13"],
      pushLatest: true,
      pushRc: false,
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

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir, release: true });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13"],
      latestPushed: true,
      rcPushed: false,
      digest: "sha256:abc123",
    });
    expect(runMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "--target",
        "runtime",
        "--build-arg",
        "BOS_GIT_SHA=cf2ab4d13",
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

  it("a non-release deploy builds and pushes the sha tag only (#571)", async () => {
    writeWorkspaceVersion("2.0.0-rc.0");
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") return undefined;
      if (cmd === "docker" && args[0] === "push") {
        return ok(
          "The push refers to repository [ghcr.io/x/y]\nsha: digest: sha256:beef00 size: 1571",
        );
      }
      return ok();
    });

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir, release: false });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13"],
      latestPushed: false,
      rcPushed: false,
      digest: "sha256:beef00",
    });
    const pushes = runMock.mock.calls.filter((c) => c[0] === "docker" && c[1][0] === "push");
    expect(pushes.map((c) => c[1][1])).toEqual(["ghcr.io/acme/app:sha-cf2ab4d13"]);
  });

  it("holds latest, pushes the exact tag, and pushes rc for a prerelease workspace version", async () => {
    writeWorkspaceVersion("2.0.0-rc.0");
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git") return ok("cf2ab4d13");
      if (cmd === "docker" && args[0] === "build") return undefined;
      if (cmd === "docker" && args[0] === "push") {
        return ok("digest: sha256:def456");
      }
      return ok();
    });

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir, release: true });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13", "v2.0.0-rc.0"],
      latestPushed: false,
      rcPushed: true,
      digest: "sha256:def456",
    });
    expect(runMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "--target",
        "runtime",
        "--build-arg",
        "BOS_GIT_SHA=cf2ab4d13",
        "-t",
        "ghcr.io/acme/app:sha-cf2ab4d13",
        "-t",
        "ghcr.io/acme/app:v2.0.0-rc.0",
        "-t",
        "ghcr.io/acme/app:rc",
        ".",
      ],
      { cwd: configDir },
    );
    const pushes = runMock.mock.calls.filter((c) => c[0] === "docker" && c[1][0] === "push");
    expect(pushes.map((c) => c[1][1])).toEqual([
      "ghcr.io/acme/app:sha-cf2ab4d13",
      "ghcr.io/acme/app:v2.0.0-rc.0",
      "ghcr.io/acme/app:rc",
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

    const result = await buildAndPushImage({ image: "ghcr.io/acme/app", configDir, release: true });

    expect(result).toEqual({
      image: "ghcr.io/acme/app",
      tag: "sha-cf2ab4d13",
      tags: ["sha-cf2ab4d13", "v2.0.0", "v2"],
      latestPushed: true,
      rcPushed: false,
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

  function okDeploy(stdout = "") {
    return { stdout, stderr: "", exitCode: 0 };
  }

  it("redeploys the service from its configured image source", async () => {
    runMock.mockResolvedValue(okDeploy("done"));

    await deployImageToRailway({
      service: "app",
      configDir,
    });

    const calls = runMock.mock.calls.filter((c) => c[0] === "railway");
    expect(calls.map((c) => c[1])).toEqual([
      ["--version"],
      ["redeploy", "--service", "app", "--from-source", "--yes"],
    ]);
    expect(calls[1][2]).toEqual(
      expect.objectContaining({ cwd: configDir, capture: true, onChunk: expect.any(Function) }),
    );
    expect(existsSync(join(configDir, ".bos", "deploy"))).toBe(false);
  });

  it("fails loudly when the railway CLI is missing", async () => {
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "railway" && args[0] === "--version") throw new Error("spawn railway ENOENT");
      return okDeploy("Deployed");
    });

    await expect(
      deployImageToRailway({
        service: "app",
        configDir,
      }),
    ).rejects.toThrow("Railway CLI not found");
  });

  it("throws with captured stream detail when the redeploy fails", async () => {
    runMock.mockImplementation(
      async (
        cmd: string,
        args: string[],
        options?: { onChunk?: (s: string, c: Buffer) => void },
      ) => {
        if (cmd === "railway" && args[0] === "--version") {
          return okDeploy("railway 5.67.1");
        }
        options?.onChunk?.("stderr", Buffer.from("service not found\n"));
        return { stdout: "", stderr: "service not found", exitCode: 1 };
      },
    );

    await expect(
      deployImageToRailway({
        service: "app",
        configDir,
      }),
    ).rejects.toThrow(/service not found/);
  });
});

describe("repointServiceSource", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-railway-pin-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function ok(stdout = "") {
    return { stdout, stderr: "", exitCode: 0 };
  }

  it("connects the service source to the pinned image ref by tag", async () => {
    runMock.mockResolvedValue(ok("connected"));

    await repointServiceSource({
      service: "app",
      image: "ghcr.io/nearbuilders/everything-dev:v2.0.0-rc.14",
      configDir,
    });

    const calls = runMock.mock.calls.filter((c) => c[0] === "railway");
    expect(calls.map((c) => c[1])).toEqual([
      ["--version"],
      [
        "service",
        "source",
        "connect",
        "--image",
        "ghcr.io/nearbuilders/everything-dev:v2.0.0-rc.14",
        "--service",
        "app",
        "--json",
      ],
    ]);
  });

  it("fails loudly when the railway CLI is missing", async () => {
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "railway" && args[0] === "--version") throw new Error("spawn railway ENOENT");
      return ok();
    });

    await expect(
      repointServiceSource({ service: "app", image: "ghcr.io/acme/app:v2.0.0", configDir }),
    ).rejects.toThrow("Railway CLI not found");
  });

  it("throws with captured stream detail when the connect fails", async () => {
    runMock.mockImplementation(
      async (
        cmd: string,
        args: string[],
        options?: { onChunk?: (s: string, c: Buffer) => void },
      ) => {
        if (cmd === "railway" && args[0] === "--version") return ok("railway 5.71.0");
        options?.onChunk?.("stderr", Buffer.from("permission denied\n"));
        return { stdout: "", stderr: "permission denied", exitCode: 1 };
      },
    );

    await expect(
      repointServiceSource({ service: "app", image: "ghcr.io/acme/app:v2.0.0", configDir }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("parseRegistryRef", () => {
  it("splits registry, repository, and tag", () => {
    expect(parseRegistryRef("ghcr.io/nearbuilders/everything-dev:v2.0.0-rc.14")).toEqual({
      registry: "ghcr.io",
      repository: "nearbuilders/everything-dev",
      tag: "v2.0.0-rc.14",
      digest: undefined,
    });
  });

  it("splits digest refs and drops the tag", () => {
    const digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(parseRegistryRef(`ghcr.io/acme/app:latest@${digest}`)).toEqual({
      registry: "ghcr.io",
      repository: "acme/app",
      tag: undefined,
      digest,
    });
  });

  it("keeps ported registries and the default tag", () => {
    expect(parseRegistryRef("localhost:5000/acme/app")).toEqual({
      registry: "localhost:5000",
      repository: "acme/app",
      tag: undefined,
      digest: undefined,
    });
  });

  it("rejects refs without an explicit registry host", () => {
    expect(parseRegistryRef("acme/app:v1")).toBeUndefined();
    expect(parseRegistryRef("app")).toBeUndefined();
  });
});

describe("resolveRegistryDigest", () => {
  const digest64 = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  interface StubResponse {
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
  }

  const res = (init: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  }): StubResponse => ({
    ok: init.status < 400,
    status: init.status,
    headers: { get: (name) => init.headers?.[name] ?? null },
    json: () => Promise.resolve(init.body),
  });

  it("heads the manifest and returns the docker-content-digest", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return res({
        status: 200,
        headers: { "docker-content-digest": digest64 },
      }) as unknown as Response;
    };

    await expect(
      resolveRegistryDigest({ ref: "ghcr.io/acme/app:v2.0.0-rc.14", fetch }),
    ).resolves.toBe(digest64);
    expect(calls[0].url).toBe("https://ghcr.io/v2/acme/app/manifests/v2.0.0-rc.14");
    expect((calls[0].init?.headers as Record<string, string>).Accept).toContain(
      "application/vnd.oci.image.index.v1+json",
    );
  });

  it("follows the WWW-Authenticate token challenge on 401", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return res({
          status: 401,
          headers: {
            "www-authenticate": `Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/app:pull"`,
          },
        }) as unknown as Response;
      }
      if (calls.length === 2) {
        return res({ status: 200, body: { token: "tok" } }) as unknown as Response;
      }
      return res({
        status: 200,
        headers: { "docker-content-digest": digest64 },
      }) as unknown as Response;
    };

    await expect(
      resolveRegistryDigest({ ref: "ghcr.io/acme/app:v2.0.0-rc.14", fetch }),
    ).resolves.toBe(digest64);
    expect(calls[1].url).toBe(
      "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aacme%2Fapp%3Apull",
    );
    expect((calls[2].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("throws when the registry has no manifest for the tag", async () => {
    const fetch = async (): Promise<Response> => res({ status: 404 }) as unknown as Response;

    await expect(resolveRegistryDigest({ ref: "ghcr.io/acme/app:v9.9.9", fetch })).rejects.toThrow(
      /no manifest.*v9\.9\.9/,
    );
  });

  it("throws on an unparsable ref", async () => {
    await expect(
      resolveRegistryDigest({
        ref: "acme/app:v1",
        fetch: async () => res({ status: 200 }) as unknown as Response,
      }),
    ).rejects.toThrow(/unparsable/i);
  });
});
