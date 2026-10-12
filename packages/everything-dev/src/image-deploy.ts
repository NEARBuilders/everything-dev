import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./utils/run";
import { colors, icons } from "./utils/theme";

export interface ResolvedImageRef {
  image: string;
  source: "ci" | "env" | "repository";
}

/**
 * Image reference resolution precedence (ADR 0021): `ci.image` in
 * bos.config.json → `BOS_IMAGE` env → derived from `repository`.
 */
export function resolveImageRef(input: {
  ciImage?: string;
  repository?: string;
  env?: Record<string, string | undefined>;
}): ResolvedImageRef | undefined {
  const envImage = input.env?.BOS_IMAGE;
  if (input.ciImage) return { image: input.ciImage, source: "ci" };
  if (envImage) return { image: envImage, source: "env" };

  const repo = input.repository
    ?.replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!repo?.includes("/") || repo.split("/").length !== 2) return undefined;
  return { image: `ghcr.io/${repo}`, source: "repository" };
}

export async function hasDocker(): Promise<boolean> {
  try {
    const result = await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      capture: true,
    });
    return result?.exitCode === 0;
  } catch {
    return false;
  }
}

function parseDigest(pushOutput: string): string | undefined {
  const match = pushOutput.match(/digest:\s*(sha256:[a-f0-9]+)/i);
  return match?.[1];
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * The runtime framework version baked into the image is the workspace source's
 * `everything-dev` package version — the image builds from `configDir`, so that
 * file is the truth. Missing (child repos without the workspace) → undefined.
 */
function readFrameworkVersion(configDir: string): string | undefined {
  try {
    const raw = readFileSync(
      join(configDir, "packages", "everything-dev", "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" && SEMVER_PATTERN.test(pkg.version)
      ? pkg.version
      : undefined;
  } catch {
    return undefined;
  }
}

export interface ImageTags {
  /** Exact refs to build and push, in push order (latest excluded). */
  tags: string[];
  /** Push `:latest` after the pinned tags. */
  pushLatest: boolean;
  /** Human-readable reason when `latest` is held. */
  latestHoldReason?: string;
}

/**
 * Tag scheme (ADR 0021): `sha-<short>` always; the exact `v<version>` tag; a
 * floating major tag (`v2`) on stable releases only. `latest` is held during
 * prereleases (npm's `rc` dist-tag analog) so existing deployments pinned to
 * `:latest` keep serving the last stable image.
 */
export function computeImageTags(input: { shortSha: string; version?: string }): ImageTags {
  const tags = [`sha-${input.shortSha}`];
  const match = input.version?.trim().match(SEMVER_PATTERN);
  if (!match) {
    return { tags, pushLatest: true };
  }
  const [, major, minor, patch, prerelease] = match;
  const exact = prerelease
    ? `v${major}.${minor}.${patch}-${prerelease}`
    : `v${major}.${minor}.${patch}`;
  if (prerelease) {
    return {
      tags: [...tags, exact],
      pushLatest: false,
      latestHoldReason: `${exact} is a prerelease — :latest still serves the last stable image`,
    };
  }
  return { tags: [...tags, exact, `v${major}`], pushLatest: true };
}

export interface ImageDeployResult {
  image: string;
  /** Primary pinned tag (the sha tag). */
  tag: string;
  /** All tags pushed, including the primary. */
  tags: string[];
  latestPushed: boolean;
  digest?: string;
}

export type DeployImagePlan =
  | { kind: "prebuilt"; image: string; digest: string }
  | { kind: "build"; image: string }
  | { kind: "skip"; reason: string };

/**
 * Decide the image leg's source: a digest handed over from a pre-pushed image
 * (the CI image job) wins; otherwise the local docker build runs when the
 * toolchain and Dockerfile are present (ADR 0021, as amended).
 */
export function resolveDeployImagePlan(input: {
  imageRef: ResolvedImageRef | undefined;
  imageDigest?: string;
  hasDocker: boolean;
  hasDockerfile: boolean;
}): DeployImagePlan {
  if (!input.imageRef) {
    return {
      kind: "skip",
      reason: "set ci.image in bos.config.json (or BOS_IMAGE) to build and push the runtime image",
    };
  }
  if (input.imageDigest) {
    return { kind: "prebuilt", image: input.imageRef.image, digest: input.imageDigest };
  }
  if (!input.hasDocker) {
    return { kind: "skip", reason: "docker is not available" };
  }
  if (!input.hasDockerfile) {
    return { kind: "skip", reason: "no Dockerfile at the config root" };
  }
  return { kind: "build", image: input.imageRef.image };
}

/**
 * Image leg (ADR 0021): build the runtime stage, tag `sha-<short>` + version
 * tags, push them, capture the digest, and push `:latest` unless the version
 * is a prerelease. Callers skip the leg with a notice when no image is
 * configured (child repos get build+upload+publish only).
 */
export async function buildAndPushImage(input: {
  image: string;
  configDir: string;
  verbose?: boolean;
}): Promise<ImageDeployResult> {
  const shaResult = await run("git", ["rev-parse", "--short=7", "HEAD"], {
    cwd: input.configDir,
    capture: true,
  });
  const shortSha = shaResult?.stdout.trim();
  if (!shaResult || shaResult.exitCode !== 0 || !shortSha) {
    const detail = shaResult?.stderr.trim();
    throw new Error(
      `Failed to resolve the current git SHA in ${input.configDir} (exit code ${shaResult?.exitCode ?? "unknown"}${detail ? `: ${detail}` : ""})`,
    );
  }

  const version = readFrameworkVersion(input.configDir);
  const { tags, pushLatest, latestHoldReason } = computeImageTags({ shortSha, version });
  const refs = tags.map((tag) => `${input.image}:${tag}`);
  const latestRef = `${input.image}:latest`;
  const buildRefs = pushLatest ? [...refs, latestRef] : refs;

  console.log(
    `  Building runtime image ${colors.cyan(buildRefs.join(", "))}${pushLatest ? "" : colors.yellow(" (latest held)")}`,
  );
  await run(
    "docker",
    ["build", "--target", "runtime", ...buildRefs.flatMap((ref) => ["-t", ref]), "."],
    { cwd: input.configDir },
  );

  console.log(`  Pushing ${colors.cyan(refs.join(", "))}...`);
  let digest: string | undefined;
  for (const ref of refs) {
    const push = await run("docker", ["push", ref], {
      cwd: input.configDir,
      capture: true,
    });
    if (!push || push.exitCode !== 0) {
      throw new Error(`docker push ${ref} failed with exit code ${push?.exitCode ?? "unknown"}`);
    }
    digest ??= parseDigest(push.stdout);
    if (input.verbose && push.stdout.trim()) {
      console.log(colors.dim(push.stdout.trim()));
    }
  }

  let latestPushed = false;
  if (pushLatest) {
    const pushLatestRef = await run("docker", ["push", latestRef], {
      cwd: input.configDir,
      capture: true,
    });
    if (!pushLatestRef || pushLatestRef.exitCode !== 0) {
      throw new Error(
        `docker push ${latestRef} failed with exit code ${pushLatestRef?.exitCode ?? "unknown"}`,
      );
    }
    digest ??= parseDigest(pushLatestRef.stdout);
    if (input.verbose && pushLatestRef.stdout.trim()) {
      console.log(colors.dim(pushLatestRef.stdout.trim()));
    }
    latestPushed = true;
  } else {
    console.log(colors.yellow(`  latest held: ${latestHoldReason}`));
  }

  if (!digest) {
    console.log(colors.yellow("  Could not capture the image digest from push output"));
  }

  return { image: input.image, tag: tags[0], tags, latestPushed, digest };
}

/**
 * Railway leg (ADR 0021): pull-only deploy of the pushed image digest — a
 * thin `FROM image@digest` Dockerfile pins the digest so Railway never
 * rebuilds; `RAILWAY_DOCKERFILE_PATH` points at the generated file.
 */
export async function deployImageToRailway(input: {
  image: string;
  digest: string;
  service: string;
  configDir: string;
}): Promise<void> {
  const deployDir = join(input.configDir, ".bos", "deploy");
  mkdirSync(deployDir, { recursive: true });
  const dockerfilePath = join(deployDir, "Dockerfile");
  writeFileSync(dockerfilePath, `FROM ${input.image}@${input.digest}\n`);

  console.log(`  Deploying to Railway service ${colors.cyan(input.service)} (pull-only)...`);
  const result = await run("railway", ["up", "--service", input.service, "--ci"], {
    cwd: input.configDir,
    capture: true,
    env: { RAILWAY_DOCKERFILE_PATH: ".bos/deploy/Dockerfile" },
  });
  if (result?.stdout) {
    for (const line of result.stdout.split("\n")) {
      if (line.trim()) console.log(`  ${colors.dim(line.trim())}`);
    }
  }
  if (!result || result.exitCode !== 0) {
    throw new Error(
      result?.stderr.trim()
        ? `railway up failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`
        : `railway up failed with exit code ${result?.exitCode ?? "unknown"}`,
    );
  }
  console.log(colors.green(`  ${icons.ok} Railway deploy complete`));
}
