import { mkdirSync, writeFileSync } from "node:fs";
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

export interface ImageDeployResult {
  image: string;
  tag: string;
  digest?: string;
}

/**
 * Image leg (ADR 0021): build the runtime stage, tag sha-<short> + latest,
 * push both, and capture the digest. Callers skip the leg with a notice when
 * no image is configured (child repos get build+upload+publish only).
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
  const tag = `sha-${shortSha}`;

  console.log(`  Building runtime image ${colors.cyan(`${input.image}:${tag}`)}...`);
  await run(
    "docker",
    [
      "build",
      "--target",
      "runtime",
      "-t",
      `${input.image}:${tag}`,
      "-t",
      `${input.image}:latest`,
      ".",
    ],
    { cwd: input.configDir },
  );

  console.log(`  Pushing ${colors.cyan(`${input.image}:${tag}`)} and ${colors.cyan(":latest")}...`);
  const pushSha = await run("docker", ["push", `${input.image}:${tag}`], {
    cwd: input.configDir,
    capture: true,
  });
  if (!pushSha || pushSha.exitCode !== 0) {
    throw new Error(
      `docker push ${input.image}:${tag} failed with exit code ${pushSha?.exitCode ?? "unknown"}`,
    );
  }
  const pushLatest = await run("docker", ["push", `${input.image}:latest`], {
    cwd: input.configDir,
    capture: true,
  });
  if (!pushLatest || pushLatest.exitCode !== 0) {
    throw new Error(
      `docker push ${input.image}:latest failed with exit code ${pushLatest?.exitCode ?? "unknown"}`,
    );
  }
  if (input.verbose && pushSha.stdout.trim()) {
    console.log(colors.dim(pushSha.stdout.trim()));
  }

  const digest = parseDigest(pushSha.stdout) ?? parseDigest(pushLatest.stdout);
  if (!digest) {
    console.log(colors.yellow("  Could not capture the image digest from push output"));
  }

  return { image: input.image, tag, digest };
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
