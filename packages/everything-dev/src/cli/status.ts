import { existsSync } from "node:fs";
import { join } from "node:path";
import { findBosConfigPathInDir, readBosConfigSource } from "../config-source";
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

async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  return fetchJsonOrNull<{ version: string }>(`https://registry.npmjs.org/${packageName}/latest`, {
    headers: { Accept: "application/json" },
    retries: 0,
  }).then((data) => data?.version ?? null);
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
  const configPath = findBosConfigPathInDir(projectDir);
  if (!configPath) {
    return {
      status: "error",
      error: "No bos config file found in current directory",
      packages: [],
      envFile: "missing",
    };
  }

  const config = readBosConfigSource(configPath) as Record<string, unknown>;

  const packageNames = [...FRAMEWORK_PACKAGES];
  for (const name of CATALOG_TOOL_PACKAGES) {
    if (readInstalledVersion(projectDir, name)) {
      packageNames.push(name);
    }
  }

  const packages = await Promise.all(
    packageNames.map(async (name) => {
      const resolved = resolveFrameworkPackage(projectDir, name);
      const latest = await fetchLatestNpmVersion(name);
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
