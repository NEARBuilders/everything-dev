import { existsSync } from "node:fs";
import { join } from "node:path";
import { MISSING_CONFIG_MESSAGE, readAuthoredConfigInput } from "../config";
import type { StatusResult } from "../contract";
import { fetchBosConfigFromFastKv } from "../fastkv";
import { fetchJsonOrNull } from "../http-client";
import { readInstalledFrameworkVersion, resolveFrameworkPackage } from "./framework-version";
import { readSnapshot } from "./snapshot";

const FRAMEWORK_PACKAGES = ["everything-dev", "every-plugin"];

const CATALOG_TOOL_PACKAGES = [
  "@rspack/core",
  "@rspack/cli",
  "@rsbuild/core",
  "@rsbuild/plugin-react",
  "@module-federation/enhanced",
  "@module-federation/node",
  "@module-federation/rsbuild-plugin",
  "@module-federation/runtime-core",
  "@module-federation/sdk",
  "@module-federation/dts-plugin",
] as const;

const PRERELEASE_PATTERN = /-[0-9A-Za-z.-]+$/;

/**
 * The dist-tag to compare an installed version against: prerelease installs
 * track the `rc` dist-tag (the changesets pre-mode train), stable installs
 * track `latest`. Falls back to `latest` when no `rc` tag is published.
 */
export function resolveUpdateDistTag(installed: string | undefined): "rc" | "latest" {
  return installed && PRERELEASE_PATTERN.test(installed) ? "rc" : "latest";
}

/** The version a given dist-tag currently points at, or null when absent. */
export function pickDistTagVersion(
  distTags: Record<string, string> | undefined,
  tag: "rc" | "latest",
): string | null {
  return distTags?.[tag] ?? null;
}

async function fetchLatestNpmVersion(
  packageName: string,
  tag: "rc" | "latest",
): Promise<string | null> {
  if (tag === "latest") {
    return fetchJsonOrNull<{ version: string }>(
      `https://registry.npmjs.org/${packageName}/latest`,
      {
        headers: { Accept: "application/json" },
        retries: 0,
      },
    ).then((data) => data?.version ?? null);
  }
  const packument = await fetchJsonOrNull<{ "dist-tags"?: Record<string, string> }>(
    `https://registry.npmjs.org/${packageName}`,
    {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      retries: 0,
    },
  );
  return pickDistTagVersion(packument?.["dist-tags"], tag);
}

function readInstalledVersion(projectDir: string, packageName: string): string | undefined {
  return readInstalledFrameworkVersion(projectDir, packageName);
}

function checkEnvFile(projectDir: string): "found" | "missing" | "example-only" {
  if (existsSync(join(projectDir, ".env"))) return "found";
  if (existsSync(join(projectDir, ".env.example"))) return "example-only";
  return "missing";
}

async function checkParentReachable(extendsRef: string | undefined): Promise<boolean | undefined> {
  if (!extendsRef?.startsWith("bos://")) return undefined;
  try {
    const config = await fetchBosConfigFromFastKv(extendsRef);
    return config !== null;
  } catch {
    return false;
  }
}

export async function getStatus(projectDir: string): Promise<StatusResult> {
  const authored = await readAuthoredConfigInput(projectDir);
  if (!authored) {
    return {
      status: "error",
      error: `${MISSING_CONFIG_MESSAGE} in current directory`,
      packages: [],
      envFile: "missing",
    };
  }

  const config = authored as Record<string, unknown>;

  const packageNames = [...FRAMEWORK_PACKAGES];
  for (const name of CATALOG_TOOL_PACKAGES) {
    if (readInstalledVersion(projectDir, name)) {
      packageNames.push(name);
    }
  }

  const packages = await Promise.all(
    packageNames.map(async (name) => {
      const resolved = resolveFrameworkPackage(projectDir, name);
      const tag = FRAMEWORK_PACKAGES.includes(name)
        ? resolveUpdateDistTag(resolved.installedVersion)
        : "latest";
      const latest = await fetchLatestNpmVersion(name, tag);
      return {
        name,
        installed: resolved.installedVersion,
        latest: latest ?? undefined,
        isLinked: resolved.isLinked,
        specifier: resolved.specifier,
      };
    }),
  );

  const snapshot = await readSnapshot(projectDir);

  const extendsRef = config.extends as string | undefined;
  const parentReachable = await checkParentReachable(extendsRef);

  return {
    status: "ok",
    extends: extendsRef,
    account: config.account as string | undefined,
    domain: config.domain as string | undefined,
    packages,
    lastSync: snapshot?.timestamp,
    envFile: checkEnvFile(projectDir),
    parentReachable,
  };
}
