import {
  constructTree,
  type RouteConfigModule,
  type RouteOptionsBundle,
} from "everything-dev/ui/manifest";
import { describe, expect, it } from "vitest";

/**
 * Construction-level integration: the auth plugin's real route shape (login
 * under the core-owned `_public` mount, settings under `_authenticated`)
 * composes into one host-built tree with URL-stable paths.
 */

const CORE_MANIFEST = {
  name: "ui",
  manifestVersion: 1,
  routes: [
    { id: "_public", isLayout: true, mount: "public", file: "_public.tsx" },
    {
      id: "_public/index",
      path: "/",
      isIndex: true,
      parentId: "_public",
      file: "_public/index.tsx",
    },
    { id: "_authenticated", isLayout: true, mount: "authenticated", file: "_authenticated.tsx" },
  ],
};

const AUTH_MANIFEST = {
  name: "auth",
  manifestVersion: 1,
  routes: [
    { id: "_public/login", path: "/login", file: "_public/login.tsx" },
    {
      id: "_authenticated/settings",
      path: "/settings",
      parentId: "_authenticated",
      file: "_authenticated/settings.tsx",
    },
    {
      id: "_authenticated/settings/index",
      path: "/",
      isIndex: true,
      parentId: "_authenticated/settings",
      file: "_authenticated/settings/index.tsx",
    },
  ],
};

function routeConfigOf(
  routes: Array<{ id: string }>,
  options: Record<string, RouteOptionsBundle>,
): RouteConfigModule {
  return {
    routeConfigLoaders: Object.fromEntries(
      routes.map((record) => [record.id, async () => options[record.id] ?? {}]),
    ),
  };
}

describe("constructTree over the auth route shape", () => {
  it("parents cross-source routes onto the core-owned mounts with URL-stable paths", async () => {
    const coreRouteConfig = routeConfigOf(CORE_MANIFEST.routes, {
      _authenticated: { beforeLoad: () => undefined },
    });
    const authRouteConfig = routeConfigOf(AUTH_MANIFEST.routes, {
      "_public/login": { staticData: { nav: { label: "Login", order: 1 } } },
    });

    const tree = await constructTree({
      name: "app",
      plugins: [
        { key: "ui", mfName: "ui" },
        { key: "auth", mfName: "auth-ui" },
      ],
      resolve: async (ref) => {
        if (ref.key === "ui")
          return { key: "ui", manifest: CORE_MANIFEST, routeConfig: coreRouteConfig };
        return { key: "auth", manifest: AUTH_MANIFEST, routeConfig: authRouteConfig };
      },
      rootOptions: coreRouteConfig.rootMeta,
    });

    const root = tree.rootRoute as unknown as { children: Array<{ options: { id: string } }> };
    expect(root.children.map((child) => child.options.id).sort()).toEqual([
      "__mount_authenticated",
      "__mount_public",
    ]);

    const publicMount = root.children.find(
      (child) => child.options.id === "__mount_public",
    ) as unknown as {
      children: Array<{ options: { path?: string; isIndex?: boolean } }>;
    };
    expect(publicMount.children.map((child) => child.options.path).sort()).toEqual(["/", "/login"]);

    const navLogin = tree.nav.items.find((item) => item.plugin === "auth");
    expect(navLogin).toMatchObject({ to: "/login", mount: "public", plugin: "auth" });

    expect(tree.mountCounts).toEqual({ public: 2, authenticated: 2 });
  });
});
