import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EFFECT_CRITICAL_SHARED_DEPS,
  type EffectCriticalSharedDepName,
  pluginSharedDependencies,
} from "../../src/build/shared-deps";
import { MF_CORE_SHARED_DEPS, PLUGIN_VERSION } from "../../src/runtime/mf-config";

describe("mf-config sync", () => {
  let pkg: typeof import("../../package.json");
  try {
    pkg = require("../../package.json");
  } catch {
    throw new Error("Could not load package.json — version sync cannot be verified");
  }

  const resolveInstalledVersion = (packageName: string): string => {
    let currentDir = dirname(require.resolve(packageName));
    for (let i = 0; i < 5; i += 1) {
      const packageJsonPath = join(currentDir, "package.json");
      if (existsSync(packageJsonPath)) {
        return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version as string;
      }
      currentDir = dirname(currentDir);
    }

    throw new Error(`Could not resolve installed version for ${packageName}`);
  };

  const installedVersions = {
    effect: resolveInstalledVersion("effect"),
    zod: resolveInstalledVersion("zod"),
    "@orpc/client": resolveInstalledVersion("@orpc/client"),
  };

  it("versions match package.json", () => {
    expect(PLUGIN_VERSION).toBe(pkg.version);
    expect(MF_CORE_SHARED_DEPS["every-plugin"]?.version).toBe(pkg.version);
    expect(MF_CORE_SHARED_DEPS.effect?.version).toBe(installedVersions.effect);
    expect(MF_CORE_SHARED_DEPS.zod?.version).toBe(installedVersions.zod);
    expect(MF_CORE_SHARED_DEPS["@orpc/client"]?.version).toBe(installedVersions["@orpc/client"]);
  });

  it("all deps are singleton", () => {
    for (const dep of Object.values(MF_CORE_SHARED_DEPS)) {
      expect(dep.shareConfig.singleton).toBe(true);
      expect(dep.shareConfig.eager).toBe(false);
    }
  });

  it("effect-critical deps carry exact requiredVersion with strictVersion", () => {
    const critical = new Set(EFFECT_CRITICAL_SHARED_DEPS);
    for (const [name, dep] of Object.entries(MF_CORE_SHARED_DEPS)) {
      if (!critical.has(name as EffectCriticalSharedDepName)) continue;
      expect(dep.shareConfig, `${name} should pin exact version ${dep.version}`).toEqual({
        singleton: true,
        requiredVersion: dep.version,
        strictVersion: true,
        eager: false,
        shareScope: "default",
      });
    }
  });

  it("non-critical deps stay range-tolerant", () => {
    const critical = new Set(EFFECT_CRITICAL_SHARED_DEPS);
    for (const [name, dep] of Object.entries(MF_CORE_SHARED_DEPS)) {
      if (critical.has(name as EffectCriticalSharedDepName)) continue;
      expect(dep.shareConfig.requiredVersion).toBe(false);
      expect(dep.shareConfig.strictVersion).toBe(false);
    }
  });

  it("build and runtime shared deps stay aligned", () => {
    expect(Object.keys(pluginSharedDependencies).sort()).toEqual(
      Object.keys(MF_CORE_SHARED_DEPS).sort(),
    );

    for (const [name, dep] of Object.entries(pluginSharedDependencies)) {
      expect(MF_CORE_SHARED_DEPS[name]?.version).toBe(dep.version);
    }
  });
});
