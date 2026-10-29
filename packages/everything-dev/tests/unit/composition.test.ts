import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authoredSlotPaths,
  compositionSkewViolations,
  runCompositionGate,
  stampInheritedSlotsFromRelease,
} from "../../src/services/deploy/composition";
import { computeManifestSri } from "../../src/services/deploy/manifest-verify";
import { composePlatformManifestPublishEntry } from "../../src/services/deploy/platform-manifest";
import { clearSlotVersionCache } from "../../src/services/deploy/version-manifest";
import {
  type PlatformReleaseManifest,
  PlatformReleaseManifestSchema,
} from "../../src/services/platform/manifest";

/**
 * The composition plane (ADR 0034 amendment — release-scoped extends
 * inheritance): inherited base-runtime slots re-point at a platform pin's
 * release, and the train gates the extends-merged shape on shared-singleton
 * skew before publishing.
 */

const authBase = "https://cdn.test/bundles/root.near/root/auth/";
const authUiBase = "https://cdn.test/bundles/root.near/root/auth-ui/";

function uiVersionManifest(shared: Record<string, string>): string {
  return JSON.stringify({
    version: "fedcba0987654321",
    entry: "remoteEntry.js",
    entryIntegrity: "sha384-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    shared,
  });
}

function versionManifestFetcher(routes: Record<string, string>): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const text = routes[String(input)];
    if (!text) {
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => text } as unknown as Response;
  }) as typeof fetch;
}

function manifestWithSlots(slots: unknown): PlatformReleaseManifest {
  return PlatformReleaseManifestSchema.parse({
    schemaVersion: 1,
    kind: "everything-dev/platform-manifest",
    frameworkVersion: "2.0.0-rc.24",
    everyPluginVersion: "3.0.0-rc.14",
    image: { ref: "ghcr.io/nearbuilders/everything-dev", tags: ["v2.0.0-rc.24"] },
    catalog: {},
    sharedDeps: {},
    templateInventory: [],
    compat: { minChild: "2.0.0-rc.23" },
    ...(slots ? { slots } : {}),
  });
}

let tmpRoot: string;

beforeEach(() => {
  clearSlotVersionCache();
  tmpRoot = mkdtempSync(join(tmpdir(), "composition-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  clearSlotVersionCache();
});

describe("stampInheritedSlotsFromRelease", () => {
  it("stamps inherited slots (auth + auth.ui) without touching authored slots", () => {
    const payload: Record<string, unknown> = {
      account: "child.near",
      app: {
        ui: {
          production: "https://child.test/ui/",
          pin: { manifest: "mine.json", integrity: "sha384-mine" },
        },
      },
    };
    const outcome = stampInheritedSlotsFromRelease({
      payload,
      authoredConfig: structuredClone(payload),
      manifest: manifestWithSlots({
        "app.auth": {
          base: authBase,
          pin: { manifest: "versions/0123456789abcdef.json", integrity: "sha384-auth" },
        },
        "app.auth.ui": {
          base: authUiBase,
          pin: { manifest: "versions/0123456789abcdef.json", integrity: "sha384-auth-ui" },
        },
        "app.ui": {
          base: "https://attacker.test/",
          pin: { manifest: "x.json", integrity: "sha384-x" },
        },
      }),
    });

    const app = payload.app as Record<string, Record<string, unknown>>;
    expect(app.auth).toEqual({
      production: authBase,
      pin: { manifest: "versions/0123456789abcdef.json", integrity: "sha384-auth" },
      ui: {
        production: authUiBase,
        pin: { manifest: "versions/0123456789abcdef.json", integrity: "sha384-auth-ui" },
      },
    });
    expect(outcome.stamped).toEqual(["app.auth", "app.auth.ui"]);
    expect(app.ui.production).toBe("https://child.test/ui/");
    expect(app.ui.pin).toEqual({ manifest: "mine.json", integrity: "sha384-mine" });
  });

  it("stamps nothing when the release carries no slots map (pre-amendment releases)", () => {
    const payload: Record<string, unknown> = { account: "child.near" };
    const outcome = stampInheritedSlotsFromRelease({
      payload,
      authoredConfig: {},
      manifest: manifestWithSlots(undefined),
    });
    expect(outcome.stamped).toEqual([]);
    expect(payload.app).toBeUndefined();
  });

  it("overrides stale stamps from a previous release-scoped deploy", () => {
    const payload: Record<string, unknown> = {
      app: {
        auth: {
          production: "https://old.test/auth/",
          pin: { manifest: "versions/old.json", integrity: "sha384-old" },
        },
      },
    };
    stampInheritedSlotsFromRelease({
      payload,
      authoredConfig: {},
      manifest: manifestWithSlots({
        "app.auth": {
          base: authBase,
          pin: { manifest: "versions/new.json", integrity: "sha384-new" },
        },
      }),
    });
    expect((payload.app as Record<string, Record<string, unknown>>).auth).toEqual({
      production: authBase,
      pin: { manifest: "versions/new.json", integrity: "sha384-new" },
    });
  });

  it("a ui:false opt-out owns the plugin and ui slots — no stamp resurrects the surface", () => {
    const payload: Record<string, unknown> = {
      plugins: { votes: { extends: "bos://root.near/root", ui: false } },
    };
    const outcome = stampInheritedSlotsFromRelease({
      payload,
      authoredConfig: { plugins: { votes: { extends: "bos://root.near/root", ui: false } } },
      manifest: manifestWithSlots({
        "plugins.votes": {
          base: "https://cdn.test/votes/",
          pin: { manifest: "v.json", integrity: "sha384-v" },
        },
        "plugins.votes.ui": {
          base: "https://cdn.test/votes-ui/",
          pin: { manifest: "vu.json", integrity: "sha384-vu" },
        },
      }),
    });
    expect(outcome.stamped).toEqual([]);
  });

  it("a plugin authored without a ui key stamps its computed ui slot", () => {
    const payload: Record<string, unknown> = {
      plugins: { votes: { extends: "bos://root.near/root" } },
    };
    const outcome = stampInheritedSlotsFromRelease({
      payload,
      authoredConfig: { plugins: { votes: { extends: "bos://root.near/root" } } },
      manifest: manifestWithSlots({
        "plugins.votes": {
          base: "https://cdn.test/votes/",
          pin: { manifest: "v.json", integrity: "sha384-v" },
        },
        "plugins.votes.ui": {
          base: "https://cdn.test/votes-ui/",
          pin: { manifest: "vu.json", integrity: "sha384-vu" },
        },
      }),
    });
    expect(outcome.stamped).toEqual(["plugins.votes.ui"]);
  });
});

describe("authoredSlotPaths", () => {
  it("counts app entries with their ui, and string plugin refs as fully owned", () => {
    const paths = authoredSlotPaths({
      app: { ui: { x: 1 }, host: { ui: {} }, api: { ui: false } },
      plugins: { votes: { y: 1 }, legacy: "bos://parent/p", detached: { ui: false } },
    });
    expect(paths.has("app.ui")).toBe(true);
    expect(paths.has("app.ui.ui")).toBe(false);
    expect(paths.has("app.host")).toBe(true);
    expect(paths.has("app.api")).toBe(true);
    // a ui:false opt-out is an authored decision — the slot is owned
    expect(paths.has("app.api.ui")).toBe(true);
    expect(paths.has("plugins.votes")).toBe(true);
    // no ui key in the authored entry — the extends chain owns the ui slot
    expect(paths.has("plugins.votes.ui")).toBe(false);
    expect(paths.has("plugins.legacy")).toBe(true);
    expect(paths.has("plugins.legacy.ui")).toBe(true);
    expect(paths.has("plugins.detached")).toBe(true);
    expect(paths.has("plugins.detached.ui")).toBe(true);
  });
});

describe("compositionSkewViolations", () => {
  const uiText = uiVersionManifest({
    react: "19.2.9",
    "everything-dev/ui/auth": "2.0.0-rc.24",
  });
  const authUiSkewedText = uiVersionManifest({
    react: "19.2.9",
    "everything-dev/ui/auth": "2.0.0-rc.25",
  });
  const authUiAgreeText = uiVersionManifest({
    react: "19.2.9",
    "everything-dev/ui/auth": "2.0.0-rc.24",
  });

  function mergedWithUiSlots(authUiIntegrity: string): Record<string, unknown> {
    return {
      app: {
        ui: {
          production: "https://cdn.test/bundles/child.near/ui/",
          pin: {
            manifest: "versions/fedcba0987654321.json",
            integrity: computeManifestSri(uiText),
          },
        },
        auth: {
          production: authBase,
          pin: { manifest: "versions/0123456789abcdef.json", integrity: "sha384-auth" },
          ui: {
            production: authUiBase,
            pin: { manifest: "versions/0123456789abcdef.json", integrity: authUiIntegrity },
          },
        },
      },
    };
  }

  const verifiedAuthUiPin = {
    manifest: "versions/0123456789abcdef.json",
    integrity: computeManifestSri(authUiSkewedText),
  };
  const brokenAuthUiPin = {
    manifest: "versions/0123456789abcdef.json",
    integrity: "sha384-not-the-served-bytes",
  };

  it("flags the skew the incident class produces — the host boot guard's mirror", async () => {
    const merged = mergedWithUiSlots(verifiedAuthUiPin.integrity);
    const fetcher = versionManifestFetcher({
      "https://cdn.test/bundles/child.near/ui/versions/fedcba0987654321.json": uiText,
      [`${authUiBase}versions/0123456789abcdef.json`]: authUiSkewedText,
    });

    const violations = await compositionSkewViolations(merged, fetcher);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Shared singleton "everything-dev/ui/auth"');
    expect(violations[0]).toContain("2.0.0-rc.24");
    expect(violations[0]).toContain("2.0.0-rc.25");
    expect(violations[0]).toContain("bos upgrade");
  });

  it("an unresolvable source pin is skipped, not guessed", async () => {
    const merged = mergedWithUiSlots(brokenAuthUiPin.integrity);
    const fetcher = versionManifestFetcher({
      "https://cdn.test/bundles/child.near/ui/versions/fedcba0987654321.json": uiText,
      [`${authUiBase}versions/0123456789abcdef.json`]: authUiSkewedText,
    });

    expect(await compositionSkewViolations(merged, fetcher)).toEqual([]);
  });

  it("silent when all sources agree", async () => {
    const merged = mergedWithUiSlots(computeManifestSri(authUiAgreeText));
    const fetcher = versionManifestFetcher({
      "https://cdn.test/bundles/child.near/ui/versions/fedcba0987654321.json": uiText,
      [`${authUiBase}versions/0123456789abcdef.json`]: authUiAgreeText,
    });
    expect(await compositionSkewViolations(merged, fetcher)).toEqual([]);
  });

  it("ignores non-UI slots entirely", async () => {
    const merged = {
      app: {
        api: {
          production: "https://cdn.test/bundles/child.near/api/",
          pin: { manifest: "broken.json", integrity: "sha384-nothing" },
        },
      },
    };
    expect(await compositionSkewViolations(merged, versionManifestFetcher({}))).toEqual([]);
  });
});

describe("runCompositionGate — compat leg", () => {
  function scaffoldChild(platform: string, catalogReact: string): string {
    mkdirSync(join(tmpRoot, "ui"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "package.json"),
      `${JSON.stringify({
        name: "child",
        dependencies: { "everything-dev": platform },
      })}\n`,
    );
    writeFileSync(
      join(tmpRoot, "pnpm-workspace.yaml"),
      ["packages:", "  - ui", "", "catalog:", `  react: "${catalogReact}"`, ""].join("\n"),
    );
    return tmpRoot;
  }

  it("a pinned child aligned with its own release passes", async () => {
    const configDir = scaffoldChild("2.0.0-rc.24", "19.2.9");
    const report = await runCompositionGate({
      configDir,
      authoredConfig: { platform: "2.0.0-rc.24" },
      resolvedShape: {},
      resolvedRelease: { manifest: manifestWithSlots(undefined) },
    });
    expect(report.ok).toBe(true);
  });

  it("a lockfile drift (newer than the pinned release) is a red gate with the remediation", async () => {
    const configDir = scaffoldChild("2.0.0-rc.25", "19.2.9");
    const report = await runCompositionGate({
      configDir,
      authoredConfig: { platform: "2.0.0-rc.24" },
      resolvedShape: {},
      resolvedRelease: { manifest: manifestWithSlots(undefined) },
    });
    expect(report.ok).toBe(false);
    const combined = report.violations.join("\n");
    expect(combined).toContain("newer than this release");
    expect(combined).toContain("bos upgrade");
  });

  it("an unpinned config skips the compat leg — the skew cross-check is its net", async () => {
    const configDir = scaffoldChild("2.0.0-rc.25", "19.2.9");
    const report = await runCompositionGate({
      configDir,
      authoredConfig: {},
      resolvedShape: {},
      resolvedRelease: { manifest: manifestWithSlots(undefined) },
    });
    expect(report.ok).toBe(true);
  });
});

describe("composePlatformManifestPublishEntry — release slots", () => {
  function scaffoldFrameworkRoot(): string {
    mkdirSync(join(tmpRoot, "packages", "everything-dev"), { recursive: true });
    mkdirSync(join(tmpRoot, "packages", "every-plugin"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "packages", "everything-dev", "package.json"),
      `${JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.24" })}\n`,
    );
    writeFileSync(
      join(tmpRoot, "packages", "every-plugin", "package.json"),
      `${JSON.stringify({ name: "every-plugin", version: "3.0.0-rc.14" })}\n`,
    );
    writeFileSync(join(tmpRoot, "package.json"), "{}\n");
    return tmpRoot;
  }

  const releasePayload = {
    account: "root.near",
    domain: "root",
    app: {
      ui: {
        production: "https://cdn.test/bundles/root.near/root/ui/",
        pin: { manifest: "versions/ui.json", integrity: "sha384-ui" },
      },
      api: {
        production: "https://cdn.test/bundles/root.near/root/api/",
        pin: { manifest: "versions/api.json", integrity: "sha384-api" },
      },
      auth: {
        production: authBase,
        pin: { manifest: "versions/auth.json", integrity: "sha384-auth" },
        ui: {
          production: authUiBase,
          pin: { manifest: "versions/auth-ui.json", integrity: "sha384-auth-ui" },
        },
      },
    },
    plugins: {
      votes: {
        extends: "bos://root.near/root/votes",
        production: "https://cdn.test/bundles/root.near/root/votes/",
      },
    },
  };

  it("records the release's pinned slots in the manifest", () => {
    const entry = composePlatformManifestPublishEntry({
      configDir: scaffoldFrameworkRoot(),
      account: "root.near",
      gateway: "root",
      publishPayload: releasePayload,
    });
    expect(entry).not.toBeNull();
    const parsed = PlatformReleaseManifestSchema.parse(JSON.parse(entry!.value));
    expect(parsed.slots).toMatchObject({
      "app.auth": {
        base: authBase,
        pin: { manifest: "versions/auth.json", integrity: "sha384-auth" },
      },
      "app.auth.ui": {
        base: authUiBase,
        pin: { manifest: "versions/auth-ui.json", integrity: "sha384-auth-ui" },
      },
      "app.ui": {
        base: "https://cdn.test/bundles/root.near/root/ui/",
        pin: { manifest: "versions/ui.json", integrity: "sha384-ui" },
      },
      "app.api": { base: "https://cdn.test/bundles/root.near/root/api/" },
    });
    expect(parsed.slots?.["plugins.votes"]).toBeUndefined();
  });

  it("is byte-stable across compositions (slot keys sorted)", () => {
    const entry = composePlatformManifestPublishEntry({
      configDir: scaffoldFrameworkRoot(),
      account: "root.near",
      gateway: "root",
      publishPayload: releasePayload,
    });
    const reversed = {
      ...releasePayload,
      app: {
        auth: releasePayload.app.auth,
        api: releasePayload.app.api,
        ui: releasePayload.app.ui,
      },
    };
    const again = composePlatformManifestPublishEntry({
      configDir: tmpRoot,
      account: "root.near",
      gateway: "root",
      publishPayload: reversed,
    });
    expect(entry!.value).toBe(again!.value);
  });

  it("omits slots entirely without a publish payload — old readers unaffected", () => {
    const entry = composePlatformManifestPublishEntry({
      configDir: scaffoldFrameworkRoot(),
      account: "root.near",
      gateway: "root",
    });
    const parsed = PlatformReleaseManifestSchema.parse(JSON.parse(entry!.value));
    expect(parsed.slots).toBeUndefined();
  });
});
