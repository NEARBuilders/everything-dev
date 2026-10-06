import path from "node:path";
import {
  CORE_SHARED_DEPS,
  createUiSharedDeps,
  EFFECT_CRITICAL_SHARED_DEPS,
  getPluginSharedDependencies,
  isEffectCriticalSharedDep,
  mergeSharedMaps,
  resolveSharedVersion,
  SHARED_DEP_SPECS,
  SharedDependencyResolutionError,
  type SharedDependencySpec,
  toHostSharedEntry,
  UI_SHARED_DEPS,
} from "every-plugin/shared-deps-spec";
import { describe, expect, it } from "vitest";
import { MF_CORE_SHARED_DEPS } from "../../src/runtime/mf-config";

const workspaceRoot = path.resolve(process.cwd(), "../..");

const namesOf = (specs: readonly SharedDependencySpec[]) => specs.map((spec) => spec.name);

describe("shared-deps-spec canonical list", () => {
  it("pins the core (server/runtime) list consolidated from the rspack and runtime copies", () => {
    expect(namesOf(CORE_SHARED_DEPS).sort()).toEqual(
      ["every-plugin", "effect", "zod", "@orpc/contract", "@orpc/client", "@orpc/server"].sort(),
    );
  });

  it("does not share the @orpc/openapi family — their share-scope consumption breaks plugin loading", () => {
    // The v2 fleet-spec pass added @orpc/openapi, @orpc/experimental-effect,
    // and @orpc/publisher; consuming them through the share scope crashed the
    // plugin bundles at runtime (__webpack_modules__[r] is not a function —
    // the runtime's import()-based provide hands the consumer an ESM namespace
    // where a module factory is expected). They are bundled per workspace;
    // the workspace package.json declarations stay (phantom-dep fix).
    for (const name of ["@orpc/openapi", "@orpc/experimental-effect", "@orpc/publisher"]) {
      expect(namesOf(CORE_SHARED_DEPS), `${name} must not be shared`).not.toContain(name);
    }
  });

  it("pins the ui list consolidated from the rsbuild copy", () => {
    expect(namesOf(UI_SHARED_DEPS).sort()).toEqual(
      [
        "react",
        "react-dom",
        "@orpc/client",
        "@orpc/contract",
        "@tanstack/react-query",
        "@tanstack/react-router",
        "@lingui/core",
        "@lingui/react",
        "everything-dev/ui/auth",
        "everything-dev/ui/i18n",
      ].sort(),
    );
  });

  it("union dedupes the packages both copies shared, with agreeing criticality", () => {
    const names = namesOf(SHARED_DEP_SPECS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ["@orpc/client", "@orpc/contract"]) {
      expect(names.filter((n) => n === name)).toHaveLength(1);
      const spec = SHARED_DEP_SPECS.find((s) => s.name === name);
      expect(spec?.critical).toBe(true);
    }
  });

  it("effect-critical names are exactly the critical core entries", () => {
    expect(namesOf(CORE_SHARED_DEPS.filter((spec) => spec.critical)).sort()).toEqual(
      [...EFFECT_CRITICAL_SHARED_DEPS].sort(),
    );
    for (const name of EFFECT_CRITICAL_SHARED_DEPS) {
      expect(isEffectCriticalSharedDep(name)).toBe(true);
    }
    expect(isEffectCriticalSharedDep("zod")).toBe(false);
    expect(isEffectCriticalSharedDep("react")).toBe(false);
  });

  it("resolves each divergence with the strictest sound policy", () => {
    for (const name of ["zod"]) {
      const spec = CORE_SHARED_DEPS.find((s) => s.name === name);
      expect(spec?.critical, `${name} was range-tolerant in every copy`).toBe(false);
    }
    for (const spec of UI_SHARED_DEPS) {
      expect(spec.critical, `${spec.name} was strict in the rsbuild copy`).toBe(true);
    }
  });
});

describe("version resolution (loud)", () => {
  it("resolves the installed version of a core dep", () => {
    const version = resolveSharedVersion("effect");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).not.toBe("*");
    expect(version).not.toBe("latest");
  });

  it("resolves a subpath request from the building workspace root", () => {
    const version = resolveSharedVersion("everything-dev/ui/auth", {
      resolution: "subpath",
      workspaceRoot,
    });
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("throws SharedDependencyResolutionError naming the package and where it looked", () => {
    const missing = "every-plugin-shared-deps-spec-missing-fixture";
    let error: SharedDependencyResolutionError | undefined;
    try {
      resolveSharedVersion(missing);
    } catch (e) {
      error = e as SharedDependencyResolutionError;
    }
    expect(error).toBeInstanceOf(SharedDependencyResolutionError);
    expect(error?.packageName).toBe(missing);
    expect(error?.searched.length).toBeGreaterThan(0);
    expect(error?.message).toContain(missing);
  });

  it("refuses unresolved sentinels loudly for config-declared entries", () => {
    for (const version of ["*", "latest", ""]) {
      expect(() => toHostSharedEntry("react", { version })).toThrow(
        SharedDependencyResolutionError,
      );
    }
  });
});

describe("consumer derivation (structural — replaces the drift sync test)", () => {
  it("rspack config factory derives from the core spec", () => {
    const shared = getPluginSharedDependencies();
    expect(Object.keys(shared).sort()).toEqual(namesOf(CORE_SHARED_DEPS).sort());
    for (const spec of CORE_SHARED_DEPS) {
      const config = shared[spec.name];
      expect(config).toBeDefined();
      expect(config?.singleton).toBe(true);
      expect(config?.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(config?.version).toBe(
        spec.resolution === "self" ? config?.version : resolveSharedVersion(spec.name),
      );
      if (spec.critical) {
        expect(config?.requiredVersion).toBe(config?.version);
        expect(config?.strictVersion).toBe(true);
      } else {
        expect(config?.requiredVersion).toBe(false);
        expect(config?.strictVersion).toBe(false);
      }
    }
  });

  it("runtime mf-config derives from the core spec", () => {
    expect(Object.keys(MF_CORE_SHARED_DEPS).sort()).toEqual(namesOf(CORE_SHARED_DEPS).sort());
    expect(MF_CORE_SHARED_DEPS["every-plugin"]?.version).toBe(
      getPluginSharedDependencies()["every-plugin"]?.version,
    );
    for (const [name, entry] of Object.entries(MF_CORE_SHARED_DEPS)) {
      expect(entry.version).toBe(getPluginSharedDependencies()[name]?.version);
      expect(entry.shareConfig.singleton).toBe(true);
      const spec = CORE_SHARED_DEPS.find((s) => s.name === name);
      if (spec?.critical) {
        expect(entry.shareConfig.requiredVersion).toBe(entry.version);
        expect(entry.shareConfig.strictVersion).toBe(true);
      }
    }
  });

  it("rsbuild config factory derives from the ui spec", () => {
    const provider = createUiSharedDeps({ role: "provider" });
    const consumer = createUiSharedDeps({ role: "consumer" });
    expect(Object.keys(provider).sort()).toEqual(namesOf(UI_SHARED_DEPS).sort());
    expect(Object.keys(consumer).sort()).toEqual(namesOf(UI_SHARED_DEPS).sort());
    for (const spec of UI_SHARED_DEPS) {
      const entry = provider[spec.name];
      expect(entry).toBeDefined();
      expect(entry?.singleton).toBe(true);
      expect(entry?.eager).toBe(false);
      expect(entry?.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry?.requiredVersion).toBe(entry?.version);
      expect(entry?.strictVersion).toBe(true);
      expect(consumer[spec.name]?.import).toBe(false);
      expect(provider[spec.name]?.import).toBeUndefined();
    }
  });

  it("ignores declared ranges — the installed version is the only source", () => {
    const deps = createUiSharedDeps();
    expect(deps.react?.version).toBe(resolveSharedVersion("react"));
  });

  it("supports the explicit core-shell parity opt-out", () => {
    const deps = createUiSharedDeps({ strictVersion: false });
    expect(deps.react?.requiredVersion).toBe(false);
    expect(deps.react?.strictVersion).toBe(false);
    expect(deps.react?.singleton).toBe(true);
  });

  it("honors an explicit ownVersion for the every-plugin share", () => {
    const shared = getPluginSharedDependencies({ ownVersion: "9.9.9" });
    expect(shared["every-plugin"]?.version).toBe("9.9.9");
    expect(shared["every-plugin"]?.requiredVersion).toBe("9.9.9");
    expect(shared["every-plugin"]?.strictVersion).toBe(true);
  });
});

describe("ticket 12 pins (no runtime debug)", () => {
  it("every spec entry resolves in this workspace — the graph has no wildcard", () => {
    for (const spec of SHARED_DEP_SPECS) {
      const version =
        spec.resolution === "self"
          ? getPluginSharedDependencies()[spec.name]?.version
          : resolveSharedVersion(spec.name, {
              resolution: spec.resolution === "subpath" ? "subpath" : "package",
              workspaceRoot,
            });
      expect(version, `${spec.name} must resolve`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("no builder output contains a wildcard or latest version", () => {
    const outputs = [
      JSON.stringify(getPluginSharedDependencies()),
      JSON.stringify(MF_CORE_SHARED_DEPS),
      JSON.stringify(createUiSharedDeps()),
    ];
    for (const output of outputs) {
      expect(output).not.toContain('"*"');
      expect(output).not.toContain('"latest"');
    }
  });
});

describe("host registration policy helpers", () => {
  it("normalizes config-declared entries with the host defaults", () => {
    expect(toHostSharedEntry("every-plugin", { version: "2.10.1", singleton: true })).toEqual({
      version: "2.10.1",
      shareScope: "default",
      shareConfig: {
        singleton: true,
        requiredVersion: false,
        strictVersion: false,
        eager: false,
      },
    });
  });

  it("merges maps, dedupes identical entries, and throws on conflict", () => {
    const merged = mergeSharedMaps({ react: { version: "19.2.4", singleton: true } }, undefined, {
      react: { version: "19.2.4", singleton: true, requiredVersion: undefined },
    });
    expect(merged.react?.version).toBe("19.2.4");

    expect(() =>
      mergeSharedMaps(
        { react: { version: "19.2.4", singleton: true } },
        { react: { version: "19.2.4", singleton: false } },
      ),
    ).toThrow(/Conflicting shared dependency "react"/);
  });
});
