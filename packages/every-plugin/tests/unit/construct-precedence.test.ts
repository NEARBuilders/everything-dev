import { afterEach, describe, expect, it, vi } from "vitest";
import { constructTree } from "../../src/ui/manifest/construct";
import type { PluginManifest, RouteRecord } from "../../src/ui/manifest/manifest-schema";
import type { RouteConfigModule, RouteOptionsBundle } from "../../src/ui/manifest/route-config";

const options = (over: RouteOptionsBundle = {}): RouteOptionsBundle => ({ ...over });

const routeConfigOf = (manifest: PluginManifest): RouteConfigModule => ({
  routeConfigLoaders: Object.fromEntries(
    manifest.routes.map((record) => [
      record.id,
      async () => options(record.mount ? {} : { staticData: { nav: { label: "Login" } } }),
    ]),
  ),
});

const record = (over: Partial<RouteRecord> & Pick<RouteRecord, "id">): RouteRecord => ({
  type: "route",
  ...over,
});

const manifestOf = (name: string, routes: RouteRecord[]): PluginManifest => ({
  name,
  manifestVersion: 2,
  routes,
});

const loginRoute = (id: string): RouteRecord => record({ id, path: "/login" });

const mountLayout = (id: string, mount: string): RouteRecord =>
  record({ id, type: "layout", mount });

function plugin(ref: { key: string; mfName: string }, manifest: PluginManifest) {
  return {
    ref,
    resolve: async () => ({
      key: ref.key,
      manifest,
      routeConfig: routeConfigOf(manifest),
    }),
  };
}

describe("constructTree core-over-plugin precedence (ADR 0010 decision #1)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lets the core ui's route claim shadow a plugin's identical path", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    const auth = plugin(
      { key: "auth", mfName: "auth-ui" },
      manifestOf("auth", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const tree = await constructTree({
      name: "server",
      plugins: [auth.ref, core.ref],
      resolve: async (ref) => {
        const source = ref.key === "ui" ? core : auth;
        return source.resolve(ref);
      },
    });

    // The core's /login wins; the plugin's shadowed route is skipped
    // entirely — no throw, no second /login under the public mount.
    expect(tree.mountCounts.public).toBe(1);
    expect(tree.nav.items.map((item) => item.id)).toEqual(["ui:_public/login"]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        'route claim "ui:_public/login" (/login) shadows "auth:_public/login"',
      ),
    );
  });

  it("still throws on plugin-vs-plugin path collisions, naming both", async () => {
    const alpha = plugin(
      { key: "alpha", mfName: "alpha-ui" },
      manifestOf("alpha", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    // beta rides the mount alpha declares — its /login still collides.
    const beta = plugin(
      { key: "beta", mfName: "beta-ui" },
      manifestOf("beta", [loginRoute("_public/login")]),
    );

    await expect(
      constructTree({
        name: "server",
        plugins: [alpha.ref, beta.ref],
        resolve: async (ref) => (ref.key === "alpha" ? alpha.resolve(ref) : beta.resolve(ref)),
      }),
    ).rejects.toThrow(
      /path collision: "beta" route "_public\/login".*already claimed by "alpha:_public\/login"/,
    );
  });

  it("lets the core ui's mount declaration shadow a plugin's duplicate", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [mountLayout("_public", "public")]),
    );
    const auth = plugin(
      { key: "auth", mfName: "auth-ui" },
      manifestOf("auth", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const tree = await constructTree({
      name: "server",
      plugins: [core.ref, auth.ref],
      resolve: async (ref) => (ref.key === "ui" ? core.resolve(ref) : auth.resolve(ref)),
    });

    // Core's declaration wins; the plugin's routes still compose under the
    // shared mount via their own layout-record parentage.
    expect(tree.mountCounts.public).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[Compose] mount declaration"));
  });

  it("still throws on plugin-vs-plugin duplicate mount declarations", async () => {
    const alpha = plugin(
      { key: "alpha", mfName: "alpha-ui" },
      manifestOf("alpha", [mountLayout("_public", "public")]),
    );
    const beta = plugin(
      { key: "beta", mfName: "beta-ui" },
      manifestOf("beta", [mountLayout("_public", "public")]),
    );

    await expect(
      constructTree({
        name: "server",
        plugins: [alpha.ref, beta.ref],
        resolve: async (ref) => (ref.key === "alpha" ? alpha.resolve(ref) : beta.resolve(ref)),
      }),
    ).rejects.toThrow(/mount "public" declared by multiple sources: "alpha".*"beta"/);
  });

  it("still throws when the core ui itself claims the same path twice", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [
        mountLayout("_public", "public"),
        loginRoute("_public/login"),
        record({ id: "_public/login-clone", path: "/login" }),
      ]),
    );

    await expect(
      constructTree({
        name: "server",
        plugins: [core.ref],
        resolve: async (ref) => core.resolve(ref),
      }),
    ).rejects.toThrow(/path collision: "ui" route "_public\/login-clone".*"ui:_public\/login"/);
  });

  it("still throws when the core ui itself declares the same mount twice", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [mountLayout("_public", "public"), mountLayout("_public-clone", "public")]),
    );

    await expect(
      constructTree({
        name: "server",
        plugins: [core.ref],
        resolve: async (ref) => core.resolve(ref),
      }),
    ).rejects.toThrow(/mount "public" declared by multiple sources: "ui".*"ui"/);
  });

  it("is order-independent: same inputs in different caller order give identical digest and nav", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    const auth = plugin(
      { key: "auth", mfName: "auth-ui" },
      manifestOf("auth", [mountLayout("_public", "public")]),
    );
    const resolveFor = (ref: { key: string }) =>
      ref.key === "ui" ? core.resolve(ref) : auth.resolve(ref);

    const first = await constructTree({
      name: "server",
      plugins: [core.ref, auth.ref],
      resolve: resolveFor,
    });
    const second = await constructTree({
      name: "server",
      plugins: [auth.ref, core.ref],
      resolve: resolveFor,
    });

    expect(second.digest).toBe(first.digest);
    expect(second.nav).toEqual(first.nav);
    expect(second.mountCounts).toEqual(first.mountCounts);
  });
});
