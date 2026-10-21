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

  it("shadows the shadowed route's whole subtree without failing parentage", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [mountLayout("_public", "public"), loginRoute("_public/login")]),
    );
    const auth = plugin(
      { key: "auth", mfName: "auth-ui" },
      manifestOf("auth", [
        mountLayout("_public", "public"),
        loginRoute("_public/login"),
        record({ id: "_public/login/", type: "index", path: "/", parentId: "_public/login" }),
        record({
          id: "_public/login/device/approve",
          path: "/device/approve",
          parentId: "_public/login/device/",
        }),
        record({ id: "_public/login/device/", path: "/device/", parentId: "_public/login" }),
      ]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const tree = await constructTree({
      name: "server",
      plugins: [core.ref, auth.ref],
      resolve: async (ref) => (ref.key === "ui" ? core.resolve(ref) : auth.resolve(ref)),
    });

    // The core's /login shadows the plugin's login subtree — including the
    // grandchildren listed before their own shadowed parent — and the
    // composition still succeeds.
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

  it("skips a manifest route with no routeConfig loader (and its subtree) instead of crashing", async () => {
    const core = plugin(
      { key: "ui", mfName: "core-ui" },
      manifestOf("ui", [
        mountLayout("_public", "public"),
        mountLayout("_authenticated", "authenticated"),
        loginRoute("_public/login"),
      ]),
    );
    const auth = plugin(
      { key: "auth", mfName: "auth-ui" },
      manifestOf("auth", [
        record({ id: "_public/login", path: "/login" }),
        record({ id: "_authenticated/settings", path: "/settings", parentId: "_authenticated" }),
        record({
          id: "_authenticated/settings/referrals",
          path: "/referrals",
          parentId: "_authenticated/settings",
        }),
        record({
          id: "_authenticated/settings/security",
          path: "/security",
          parentId: "_authenticated/settings",
        }),
      ]),
    );
    // auth's routeConfig intentionally omits the referrals loader; security keeps its loader.
    const authConfig: RouteConfigModule = {
      routeConfigLoaders: {
        "_public/login": async () => options({ staticData: { nav: { label: "Login" } } }),
        "_authenticated/settings": async () => options({
          staticData: { nav: { label: "Settings" } },
        }),
        "_authenticated/settings/security": async () => options({
          staticData: { nav: { label: "Security" } },
        }),
      },
      rootMeta: {},
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const tree = await constructTree({
      name: "server",
      plugins: [core.ref, auth.ref],
      resolve: async (ref) => {
        if (ref.key === "ui") return core.resolve(ref);
        return { key: "auth", manifest: auth.ref.manifest, routeConfig: authConfig };
      },
    });

    // the whole tree still composes; the referrals route (and nothing else) is absent
    expect(tree.mountCounts.public).toBe(1);
    expect(tree.mountCounts.authenticated).toBe(2); // settings + security
    expect(tree.nav.items.map((item) => item.id).sort()).toEqual([
      "auth:_authenticated/settings",
      "auth:_authenticated/settings/security",
      "auth:_public/login",
      "ui:_public/login",
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        'skipping route "_authenticated/settings/referrals" in "auth" — no routeConfig loader',
      ),
    );
  });
});
