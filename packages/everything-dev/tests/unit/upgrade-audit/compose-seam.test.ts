import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_FIXTURE_PATH,
  type ConstructTreeFn,
  classifyComposeError,
  composeFindings,
  type PluginManifestData,
  runComposeProbe,
  SHADOW_LOG_MARKER,
  stubRouteConfigLoaders,
  uiClaimsLogin,
} from "../../../src/services/scaffold/upgrade-audit/checks/compose-seam";

const readFixture = (relativePath: string): string =>
  readFileSync(
    join(import.meta.dirname, "../../../src/services/scaffold/upgrade-audit", relativePath),
    "utf-8",
  );

const authFixtureManifest = (): PluginManifestData =>
  JSON.parse(readFixture(AUTH_FIXTURE_PATH)) as PluginManifestData;

const miniUi = (): PluginManifestData => ({
  name: "ui",
  manifestVersion: 2,
  routes: [
    { id: "_public", type: "layout", mount: "public" },
    { id: "_public/home", type: "route", path: "/home", parentId: "_public" },
  ],
});

const miniUiWithLogin = (): PluginManifestData => ({
  name: "ui",
  manifestVersion: 2,
  routes: [
    { id: "_public", type: "layout", mount: "public" },
    { id: "_public/home", type: "route", path: "/home", parentId: "_public" },
    { id: "_public/login", type: "route", path: "/login", parentId: "_public" },
  ],
});

const miniAuth = (): PluginManifestData => ({
  name: "auth",
  manifestVersion: 2,
  routes: [{ id: "_public/extra", type: "route", path: "/extra", parentId: "_public" }],
});

const okComposer = (): ConstructTreeFn =>
  (async () => ({ mountCounts: { public: 2 } })) as unknown as ConstructTreeFn;

const buggyComposer = (): ConstructTreeFn =>
  (async () => {
    console.log(
      `[Compose] route claim "ui:_public/login" (/login) shadows "auth:_public/login" — ${SHADOW_LOG_MARKER}`,
    );
    throw new Error(
      'unresolvable parentage in "auth": _public/login/device/approve, _public/login/device/, _public/login/',
    );
  }) as unknown as ConstructTreeFn;

const collisionComposer = (): ConstructTreeFn =>
  (async () => {
    throw new Error(
      'path collision: "auth" route "_public/login" declares "/login" which is already claimed by "ui:_public/login" under the same parent',
    );
  }) as unknown as ConstructTreeFn;

describe("classifyComposeError", () => {
  it("reads unresolvable parentage after a shadow log as the known cascade bug", () => {
    expect(classifyComposeError('unresolvable parentage in "auth": _public/login/', true)).toBe(
      "cascade-bug",
    );
  });

  it("reads unresolvable parentage without a shadow log as a genuine failure", () => {
    expect(classifyComposeError('unresolvable parentage in "auth": _public/orphan', false)).toBe(
      "compose-failed",
    );
  });

  it("reads path collisions as shadow-handling regressions", () => {
    expect(classifyComposeError('path collision: "auth" route "_public/login"', true)).toBe(
      "path-collision",
    );
  });

  it("reads anything else as a compose failure", () => {
    expect(classifyComposeError('mount "public" is not declared by any source', false)).toBe(
      "compose-failed",
    );
  });
});

describe("stubRouteConfigLoaders", () => {
  it("covers every route id of the manifest", () => {
    const manifest = authFixtureManifest();
    const loaders = stubRouteConfigLoaders(manifest);
    for (const record of manifest.routes) {
      expect(loaders[record.id]).toBeTypeOf("function");
    }
    expect(Object.keys(loaders)).toHaveLength(manifest.routes.length);
  });
});

describe("uiClaimsLogin", () => {
  it("detects the core ui /login claim", () => {
    expect(uiClaimsLogin(miniUiWithLogin())).toBe(true);
    expect(uiClaimsLogin(miniUi())).toBe(false);
  });
});

describe("runComposeProbe", () => {
  it("reports ok on a clean compose", async () => {
    const probe = await runComposeProbe(miniUi(), miniAuth(), okComposer());
    expect(probe.seam).toBe("ok");
    expect(probe.mountCounts).toEqual({ public: 2 });
    expect(probe.error).toBeUndefined();
  });

  it("classifies the buggy composer's false unresolvable parentage as cascade-bug", async () => {
    const probe = await runComposeProbe(miniUi(), miniAuth(), buggyComposer());
    expect(probe.seam).toBe("cascade-bug");
    expect(probe.error).toContain("unresolvable parentage");
    expect(probe.composeLog.some((line) => line.includes(SHADOW_LOG_MARKER))).toBe(true);
  });

  it("classifies a hard path collision as path-collision", async () => {
    const probe = await runComposeProbe(miniUi(), miniAuth(), collisionComposer());
    expect(probe.seam).toBe("path-collision");
  });

  it("classifies unexpected errors as compose-failed", async () => {
    const composer = (async () => {
      throw new Error("boom");
    }) as unknown as ConstructTreeFn;
    const probe = await runComposeProbe(miniUi(), miniAuth(), composer);
    expect(probe.seam).toBe("compose-failed");
    expect(probe.error).toBe("boom");
  });
});

describe("against the real composer and manifests", () => {
  it("composes a non-colliding pair cleanly", async () => {
    const { constructTree } = await import("every-plugin/ui/manifest");
    const probe = await runComposeProbe(
      miniUi(),
      miniAuth(),
      constructTree as unknown as ConstructTreeFn,
    );
    expect(probe.seam).toBe("ok");
    expect(probe.mountCounts?.public).toBe(2);
  });

  it("vendored auth fixture parses through parsePluginManifest", async () => {
    const { parsePluginManifest } = await import("every-plugin/ui/manifest");
    expect(() => parsePluginManifest(JSON.parse(readFixture(AUTH_FIXTURE_PATH)))).not.toThrow();
  });
});

describe("composeFindings", () => {
  it("is silent on ok", () => {
    expect(
      composeFindings({ seam: "ok", composeLog: [], uiClaimsLogin: true }, "3.0.0-rc.8"),
    ).toEqual([]);
  });

  it("warns when the generated ui manifest is absent", () => {
    const findings = composeFindings(
      { seam: "absent-ui-manifest", composeLog: [], uiClaimsLogin: false },
      "3.0.0-rc.8",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
  });

  it("blocks on the cascade bug with actionable message", () => {
    const findings = composeFindings(
      {
        seam: "cascade-bug",
        composeLog: [],
        uiClaimsLogin: true,
        error: 'unresolvable parentage in "auth"',
      },
      "3.0.0-rc.8",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("blocker");
    expect(findings[0].message).toContain("3.0.0-rc.8");
    expect(findings[0].message).toContain("cascade-splice");
  });
});
