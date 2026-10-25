import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchResponse } from "../../utils/http-client";
import { run } from "../../utils/run";
import { colors, icons } from "../../utils/theme";

export interface ResolvedImageRef {
  image: string;
  source: "env" | "repository";
}

/**
 * Image reference resolution precedence (ADR 0021): `BOS_IMAGE` env → derived
 * from `repository`. Only the root runtime builds — children never own image
 * bytes; their ref derives from the platform release manifest (ADR 0034).
 */
export function resolveImageRef(input: {
  repository?: string;
  env?: Record<string, string | undefined>;
}): ResolvedImageRef | undefined {
  const envImage = input.env?.BOS_IMAGE;
  if (envImage) return { image: envImage, source: "env" };

  const repo = input.repository
    ?.replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!repo?.includes("/") || repo.split("/").length !== 2) return undefined;
  return { image: `ghcr.io/${repo}`, source: "repository" };
}

/** Compose the runnable image ref: `image@sha256:…` when a digest exists,
 * `image` alone otherwise. Never docker-run the bare ref in a deploy flow —
 * the implicit `:latest` is held to the last stable release during
 * prereleases (ADR 0021), which boots a different framework build than the
 * one this train pinned. */
export function imageRefWithDigest(image: string, digest?: string): string {
  return digest ? `${image}@${digest}` : image;
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
 * Exported for the platform release manifest composer (ADR 0034) — one version
 * source for the image, the manifest, and the npm gate.
 */
export function readFrameworkVersion(configDir: string): string | undefined {
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
  /** Push `:rc` after the pinned tags — the floating prerelease-train ref. */
  pushRc: boolean;
}

/**
 * Tag scheme (ADR 0021): `sha-<short>` always; the exact `v<version>` tag; a
 * floating major tag (`v2`) on stable releases only. `latest` is held during
 * prereleases (npm's `rc` dist-tag analog) so existing deployments pinned to
 * `:latest` keep serving the last stable image — and `:rc` is the floating
 * ref for the prerelease train (npm's `rc` dist-tag mirror): it moves on
 * every prerelease deploy and freezes at the last rc-train build once the
 * workspace releases a stable version.
 */
export function computeImageTags(input: { shortSha: string; version?: string }): ImageTags {
  const tags = [`sha-${input.shortSha}`];
  const match = input.version?.trim().match(SEMVER_PATTERN);
  if (!match) {
    return { tags, pushLatest: true, pushRc: false };
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
      pushRc: true,
    };
  }
  return { tags: [...tags, exact, `v${major}`], pushLatest: true, pushRc: false };
}

export interface ImageDeployResult {
  image: string;
  /** Primary pinned tag (the sha tag). */
  tag: string;
  /** All tags pushed, including the primary. */
  tags: string[];
  latestPushed: boolean;
  /** Whether the floating `:rc` prerelease-train ref was pushed. */
  rcPushed: boolean;
  digest?: string;
}

export type DeployImagePlan =
  | { kind: "prebuilt"; image: string; digest: string }
  | { kind: "build"; image: string }
  | { kind: "skip"; reason: string };

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** A Railway pin is `FROM image@<digest>` — anything else cannot resolve. */
export function isValidImageDigest(digest: string): boolean {
  return DIGEST_PATTERN.test(digest);
}

export interface RegistryRef {
  registry: string;
  repository: string;
  tag?: string;
  digest?: string;
}

/**
 * Split a container image ref into registry/repository/tag/digest. The
 * registry must be explicit (a dotted host, optionally ported, or
 * `localhost`) — the platform's refs are always `ghcr.io/<owner>/<name>`
 * (ADR 0034 manifest ref, or the `repository` derivation).
 */
export function parseRegistryRef(ref: string): RegistryRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0) return undefined;
  const registry = ref.slice(0, slash);
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/.test(registry) &&
    !/^localhost(?::\d+)?$/.test(registry)
  ) {
    return undefined;
  }
  const rest = ref.slice(slash + 1);
  if (!rest.includes("/")) return undefined;
  let name = rest;
  let tag: string | undefined;
  let digest: string | undefined;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    const addressed = rest.slice(0, at);
    // A digest wins over a tag (docker ref semantics) — the tag is dropped.
    const colon = addressed.lastIndexOf(":");
    name = colon > addressed.lastIndexOf("/") ? addressed.slice(0, colon) : addressed;
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon > rest.lastIndexOf("/")) {
      tag = rest.slice(colon + 1);
      name = rest.slice(0, colon);
    }
  }
  if (!name) return undefined;
  return { registry, repository: name, tag, digest };
}

/** Manifest media types a registry may serve — both OCI and Docker, index
 * and manifest, so the HEAD is answered for any image layout. */
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Resolve a tag's digest from the OCI distribution API (ADR 0034: the digest
 * derives, never embeds). Follows the spec's token flow — an anonymous probe
 * reads the `WWW-Authenticate` challenge, mints a pull token at the realm,
 * and retries; public images (ghcr.io) never need credentials. A missing
 * manifest throws — the child pin cannot be verified, and that is a failure.
 */
export async function resolveRegistryDigest(input: {
  ref: string;
  fetch?: typeof fetchResponse;
}): Promise<string> {
  const parsed = parseRegistryRef(input.ref);
  if (!parsed) {
    throw new Error(`Cannot resolve a digest — unparsable image ref "${input.ref}"`);
  }
  const doFetch = input.fetch ?? fetchResponse;
  const manifestUrl = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${parsed.digest ?? parsed.tag ?? "latest"}`;

  const head = async (headers: Record<string, string>): Promise<Response> => {
    try {
      return await doFetch(manifestUrl, {
        method: "HEAD",
        headers: { Accept: MANIFEST_ACCEPT, ...headers },
      });
    } catch (cause) {
      throw new Error(
        `Registry ${parsed.registry} unreachable while resolving ${input.ref}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  let res = await head({});
  if (res.status === 401) {
    const challenge = res.headers.get("www-authenticate") ?? "";
    const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
    if (realm) {
      const tokenUrl = new URL(realm);
      const service = /service="([^"]+)"/.exec(challenge)?.[1];
      const scope = /scope="([^"]+)"/.exec(challenge)?.[1];
      if (service) tokenUrl.searchParams.set("service", service);
      if (scope) tokenUrl.searchParams.set("scope", scope);
      const tokenRes = await doFetch(tokenUrl.href, { headers: { Accept: "application/json" } });
      if (!tokenRes.ok) {
        throw new Error(
          `Registry ${parsed.registry} token realm returned HTTP ${tokenRes.status} while resolving ${input.ref}`,
        );
      }
      const body = (await tokenRes.json()) as { token?: string };
      if (body.token) {
        res = await head({ Authorization: `Bearer ${body.token}` });
      }
    }
  }

  const digest = res.headers.get("docker-content-digest");
  if (!res.ok || !digest) {
    throw new Error(
      `The registry has no manifest for ${input.ref} (HTTP ${res.status}) — the pin cannot be verified`,
    );
  }
  return digest;
}

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
      reason:
        "set BOS_IMAGE (or repository in bos.config.json) to build and push the runtime image",
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
 * tags, push them, capture the digest, then push the floating refs — `:latest`
 * unless the version is a prerelease, and `:rc` when it is. Callers skip the
 * leg with a notice when no image is configured (child repos get
 * build+upload+publish only).
 */
/**
 * Release-conditional tags (#571): on the release leg the computed tags move
 * verbatim; a non-release deploy keeps only the sha tag and pushes no
 * floating ref — version tags stay append-only (the property pinned
 * children's digest derivation depends on).
 */
export function conditionImageTags(
  computed: ImageTags,
  release: boolean,
): { tags: string[]; pushLatest: boolean; pushRc: boolean } {
  if (release) {
    return { tags: computed.tags, pushLatest: computed.pushLatest, pushRc: computed.pushRc };
  }
  return {
    tags: computed.tags.filter((tag) => tag.startsWith("sha-")),
    pushLatest: false,
    pushRc: false,
  };
}

export async function buildAndPushImage(input: {
  image: string;
  configDir: string;
  verbose?: boolean;
  /** Release-conditional tags (#571): version + floating tags only on the
   * release leg — non-release (or unverifiable) deploys push `sha-<short>`
   * only, so version image tags are append-only (the property pinned
   * children's digest derivation depends on). */
  release?: boolean;
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
  // The full HEAD rides a build arg into the in-image platform manifest
  // (#537) — docker contexts carry no .git for the composer to read.
  const fullShaResult = await run("git", ["rev-parse", "HEAD"], {
    cwd: input.configDir,
    capture: true,
  });
  const fullSha = fullShaResult?.exitCode === 0 ? fullShaResult.stdout.trim() : undefined;

  const version = readFrameworkVersion(input.configDir);
  const computed = computeImageTags({ shortSha, version });
  const releaseLeg = input.release === true;
  const { tags: pushTags, pushLatest, pushRc } = conditionImageTags(computed, releaseLeg);
  const latestHoldReason = releaseLeg
    ? computed.latestHoldReason
    : "non-release deploy — version tags move on the release leg";
  const refs = pushTags.map((tag) => `${input.image}:${tag}`);
  const latestRef = `${input.image}:latest`;
  const rcRef = `${input.image}:rc`;
  const buildRefs = pushLatest && releaseLeg ? [...refs, latestRef] : [...refs];
  if (pushRc && releaseLeg) buildRefs.push(rcRef);

  console.log(
    `  Building runtime image ${colors.cyan(buildRefs.join(", "))}${pushLatest ? "" : colors.yellow(" (latest held)")}`,
  );
  await run(
    "docker",
    [
      "build",
      "--target",
      "runtime",
      ...(fullSha ? ["--build-arg", `BOS_GIT_SHA=${fullSha}`] : []),
      ...buildRefs.flatMap((ref) => ["-t", ref]),
      ".",
    ],
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

  const pushFloating = async (ref: string): Promise<boolean> => {
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
    return true;
  };

  let latestPushed = false;
  if (pushLatest && releaseLeg) {
    latestPushed = await pushFloating(latestRef);
  } else {
    console.log(colors.yellow(`  latest held: ${latestHoldReason}`));
  }
  const rcPushed = pushRc && releaseLeg ? await pushFloating(rcRef) : false;

  if (!digest) {
    console.log(colors.yellow("  Could not capture the image digest from push output"));
  }

  return { image: input.image, tag: pushTags[0]!, tags: pushTags, latestPushed, rcPushed, digest };
}

async function requireRailwayCli(configDir: string): Promise<string> {
  // The probe is authoritative: runners don't ship the CLI, and a spawn
  // failure resolves (reject:false) as exitCode 1 with empty output — the
  // 2026-10-13 deploy surfaced exactly that as a silent instant failure.
  let version: string | undefined;
  try {
    version = (await run("railway", ["--version"], { cwd: configDir, capture: true }))?.stdout;
  } catch {
    version = undefined;
  }
  if (!version?.trim()) {
    throw new Error("Railway CLI not found. Install it: npm i -g @railway/cli");
  }
  console.log(`  ${colors.dim(`railway ${version.trim()}`)}`);
  return version.trim();
}

async function runRailwayStreaming(
  args: readonly string[],
  input: { configDir: string },
): Promise<void> {
  // Stream the CLI's output live — a silent exit (empty stdout+stderr, seen
  // on the 2026-10-13 deploy) must still be diagnosable from the workflow log.
  const collected = { stdout: "", stderr: "" };
  const result = await run("railway", [...args], {
    cwd: input.configDir,
    capture: true,
    onChunk: (stream, chunk) => {
      collected[stream] += chunk.toString("utf-8");
      for (const line of chunk.toString("utf-8").split("\n")) {
        if (line.trim()) console.log(`  ${colors.dim(line.trim())}`);
      }
    },
  });
  if (!result || result.exitCode !== 0) {
    const exitCode = result?.exitCode ?? "unknown";
    const tail = (stream: string, text: string) =>
      text.trim()
        ? `\nrailway ${stream} (tail):\n${text.trim().split("\n").slice(-20).join("\n")}`
        : "";
    throw new Error(
      `railway ${args[0]} failed with exit code ${exitCode}` +
        tail("stdout", collected.stdout) +
        tail("stderr", collected.stderr),
    );
  }
}

/**
 * Pin the service's source to an exact image ref (Railway `ServiceConnect`):
 * a child deploy repoints the dashboard-connected source at the platform
 * manifest's `ref:tag` (ADR 0034), so the following `redeploy --from-source`
 * pulls the pinned bytes instead of whatever a floating ref moved to. The
 * project-scoped RAILWAY_TOKEN already authorizes the redeploy — connect
 * runs in the same context. The ref pins by tag: the train's version/sha
 * tags are append-only, and Railway's deployment history pins the exact
 * digest each deployment pulled (ADR 0021).
 */
export async function repointServiceSource(input: {
  service: string;
  image: string;
  configDir: string;
}): Promise<void> {
  console.log(
    `  Pinning Railway service ${colors.cyan(input.service)} source to ${colors.cyan(input.image)}...`,
  );
  await requireRailwayCli(input.configDir);
  await runRailwayStreaming(
    ["service", "source", "connect", "--image", input.image, "--service", input.service, "--json"],
    input,
  );
  console.log(colors.green(`  ${icons.ok} Railway service source pinned`));
}

/**
 * Railway leg (ADR 0021, amended): image-backed deploy. The service's source
 * is a Docker image ref (connected once in the dashboard — `:rc` during the
 * prerelease train — or repointed to the child's platform-manifest pin by
 * `repointServiceSource`), and `redeploy --from-source` pulls and deploys
 * whatever that ref points at. The image leg pushes `:rc` (and the
 * `sha-<short>` / version tags) immediately before this step, so the pulled
 * bytes are exactly what this train validated. Railway skips the build
 * entirely for Docker-image sources — nothing is uploaded, nothing is built
 * on Railway, and the digest-pin Dockerfile mechanism this replaces is gone
 * (the CLI v5 dropped RAILWAY_DOCKERFILE_PATH, its snapshot respects
 * .gitignore so generated Dockerfiles never shipped, and its Metal builder
 * rejected the repo Dockerfile's cache-mount ids).
 */
export async function deployImageToRailway(input: {
  service: string;
  configDir: string;
}): Promise<void> {
  console.log(`  Deploying to Railway service ${colors.cyan(input.service)} (image-backed)...`);
  await requireRailwayCli(input.configDir);
  await runRailwayStreaming(
    ["redeploy", "--service", input.service, "--from-source", "--yes"],
    input,
  );
  console.log(colors.green(`  ${icons.ok} Railway deploy complete`));
}
