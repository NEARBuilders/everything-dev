import { describe, expect, it } from "vitest";
import { applyCompositionLockfile } from "../../src/services/lockfile/boot";
import { lockfileOf } from "../../src/services/lockfile/schema";
import { BosConfigSchema } from "../../src/types";

/**
 * The boot-side lockfile application (ADR 0042 ticket 03): the frozen
 * composition is the authority for remote coordinates — missing pins are
 * stamped, drifted coordinates are overridden (and reported), agreement is a
 * no-op — while the boot itself never fails because of the lockfile
 * (`bos lock --check` in CI is the enforcement).
 */

const config = BosConfigSchema.parse({
  account: "v1.citynode.near",
  domain: "citynode.app",
  app: {
    host: {
      development: "local:host",
      production: "https://cdn/host/",
      digest: { manifest: "versions/aaa.json", integrity: "sha384-host-manifest-sri" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn/ui/",
      // the serving pin — no frozen counterpart in some tests
      integrity: "sha384-ui-direct-sri",
    },
    api: {
      development: "local:api",
      production: "https://cdn/api/",
      digest: { manifest: "versions/ccc.json", integrity: "sha384-api-manifest-sri" },
    },
  },
  plugins: {
    votes: "votes",
  },
});

const REF = { account: "v1.citynode.near", gateway: "citynode.app" };

describe("applyCompositionLockfile", () => {
  it("agreement is a no-op — the config keeps its identity", () => {
    const lock = lockfileOf({ ...REF, config });
    const application = applyCompositionLockfile(config, lock);
    expect(application.config).toBe(config);
    expect(application.applied).toEqual([]);
    expect(application.drift).toEqual([]);
  });

  it("stamps the frozen descriptor where the resolved remote has no pin", () => {
    const base = structuredClone(config);
    const pinned = BosConfigSchema.parse({
      ...base,
      app: {
        ...base.app,
        ui: {
          ...base.app.ui,
          digest: { manifest: "versions/bbb.json", integrity: "sha384-manifest-sri" },
        },
      },
    });
    const lock = lockfileOf({ ...REF, config: pinned });
    const unpinned = BosConfigSchema.parse({
      ...base,
      app: { ...base.app, ui: { ...base.app.ui, digest: undefined } },
    });
    const application = applyCompositionLockfile(unpinned, lock);
    expect(application.applied).toEqual(["app.ui"]);
    expect(application.config.app.ui.digest).toEqual({
      manifest: "versions/bbb.json",
      integrity: "sha384-manifest-sri",
    });
    expect(application.drift).toEqual([]);
  });

  it("the frozen composition wins a digest disagreement — and reports it", () => {
    const lock = lockfileOf({ ...REF, config });
    const drifted = BosConfigSchema.parse({
      ...structuredClone(config),
      app: {
        ...structuredClone(config).app,
        api: {
          ...structuredClone(config).app.api,
          digest: { manifest: "versions/DRIFTED.json", integrity: "sha384-other" },
        },
      },
    });
    const application = applyCompositionLockfile(drifted, lock);
    expect(application.drift).toEqual([
      {
        path: "app.api",
        detail: "serving versions/DRIFTED.json differs from the frozen versions/ccc.json",
      },
    ]);
    expect(application.config.app.api.digest).toEqual({
      manifest: "versions/ccc.json",
      integrity: "sha384-api-manifest-sri",
    });
  });

  it("a pluginRef disagreement is drift — the frozen ref wins", () => {
    const lock = lockfileOf({ ...REF, config });
    const renamed = BosConfigSchema.parse({
      ...structuredClone(config),
      plugins: { votes: "votes-renamed" },
    });
    const application = applyCompositionLockfile(renamed, lock);
    expect(application.drift).toEqual([
      { path: "plugins.votes", detail: "plugin ref votes-renamed differs from the frozen votes" },
    ]);
    expect(application.config.plugins.votes).toBe("votes");
  });

  it("a remote the composition no longer carries is drift — reported, not resurrected", () => {
    const lock = lockfileOf({ ...REF, config });
    const shrunk = BosConfigSchema.parse({
      ...structuredClone(config),
      app: {
        host: structuredClone(config).app.host,
        ui: structuredClone(config).app.ui,
        api: structuredClone(config).app.api,
      },
      plugins: {},
    });
    const application = applyCompositionLockfile(shrunk, lock);
    const paths = application.drift.map((entry) => entry.path);
    expect(paths).toContain("plugins.votes");
    expect(application.config.plugins).toEqual({});
  });

  it("a lockfile for another runtime is not applied — one drift note, config untouched", () => {
    const lock = lockfileOf({ account: "other.near", gateway: "other.dev", config });
    const application = applyCompositionLockfile(config, lock);
    expect(application.config).toBe(config);
    expect(application.applied).toEqual([]);
    expect(application.drift).toEqual([
      {
        path: "*",
        detail:
          "the lockfile freezes bos://other.near/other.dev, not this runtime (bos://v1.citynode.near/citynode.app) — not applied",
      },
    ]);
  });
});
