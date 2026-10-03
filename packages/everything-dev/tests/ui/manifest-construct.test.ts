import { createRouter, isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  constructTree,
  digestOf,
  type ResolvedPlugin,
  type RouteOptionsBundle,
} from "../../src/ui/manifest/index";
import type { RouteRecord } from "../../src/ui/manifest/manifest-schema";

interface TestPlugin {
  key: string;
  routes: RouteRecord[];
  optionsById?: Record<string, RouteOptionsBundle>;
  rootMeta?: RouteOptionsBundle;
}

const makePlugin = (plugin: TestPlugin): ResolvedPlugin => ({
  key: plugin.key,
  manifest: { name: plugin.key, manifestVersion: 1, routes: plugin.routes },
  routeConfig: {
    routeConfigLoaders: Object.fromEntries(
      plugin.routes.map((record) => [record.id, async () => plugin.optionsById?.[record.id] ?? {}]),
    ),
    ...(plugin.rootMeta ? { rootMeta: plugin.rootMeta } : {}),
  },
});

const construct = (plugins: TestPlugin[], rootOptions?: RouteOptionsBundle) =>
  constructTree({
    name: "app",
    plugins: plugins.map((plugin) => ({ key: plugin.key, mfName: plugin.key })),
    resolve: async (ref) => makePlugin(plugins.find((plugin) => plugin.key === ref.key)!),
    ...(rootOptions ? { rootOptions } : {}),
  });

const mountLayout = (mount: string): RouteRecord => ({ id: `_${mount}`, isLayout: true, mount });
const route = (id: string, path: string, extra: Partial<RouteRecord> = {}): RouteRecord => ({
  id,
  path,
  ...extra,
});

describe("constructTree", () => {
  it("mount routes compose the registry gate BEFORE the declaration's beforeLoad", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        route("_authenticated/index", "/", { parentId: "_authenticated" }),
      ],
      optionsById: {
        _authenticated: {
          component: () => null,
          beforeLoad: () => ({ fromDeclaration: "yes" }),
        },
      },
    };

    const tree = await construct([core]);
    const mount = (tree.rootRoute as unknown as { children: Array<Record<string, any>> })
      .children[0]!;
    const beforeLoad = mount.options.beforeLoad as (args: unknown) => Promise<unknown>;

    const gateThrow = () => beforeLoad({ context: {}, location: { pathname: "/", searchStr: "" } });
    expect(gateThrow).toThrow();

    const returned = await beforeLoad({
      context: { user: { id: "u1" } },
      location: { pathname: "/", searchStr: "" },
    });
    expect(returned).toEqual({ fromDeclaration: "yes" });
  });

  it("layout routes pass loader/beforeLoad/head/staticData through to the constructed route", async () => {
    const loader = () => Promise.resolve(null);
    const beforeLoad = () => ({ auth: { isAuthenticated: true } });
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        { id: "_authenticated/_wizard", isLayout: true, parentId: "_authenticated" },
        route("_authenticated/_wizard/step", "/step", { parentId: "_authenticated/_wizard" }),
      ],
      optionsById: {
        "_authenticated/_wizard": {
          component: () => null,
          loader,
          beforeLoad,
          head: () => ({ meta: [{ title: "Wizard" }] }),
          staticData: { nav: { label: "Wizard" } },
        },
      },
    };

    const tree = await construct([core]);
    const mount = (tree.rootRoute as unknown as { children: Array<Record<string, any>> })
      .children[0]!;
    const wizard = mount.children[0]!;
    expect(wizard.options.loader).toBe(loader);
    expect(wizard.options.beforeLoad).toBe(beforeLoad);
    expect(wizard.options.head).toBeTypeOf("function");
    expect(wizard.options.staticData).toEqual({ nav: { label: "Wizard" } });
  });

  it("validates a composed plugin route's search before the route sees it", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/dashboard", "/dashboard")],
    };
    const auth: TestPlugin = {
      key: "auth",
      routes: [route("_public/login", "/login")],
      optionsById: {
        "_public/login": {
          validateSearch: (search: Record<string, unknown>) => ({
            redirect:
              typeof search.redirect === "string" && search.redirect.startsWith("/")
                ? search.redirect
                : "/dashboard",
          }),
        },
      },
    };

    const tree = await construct([core, auth]);
    const router = createRouter({ routeTree: tree.rootRoute });
    const login = router.matchRoutes("/login", { redirect: "https://example.com/" }).at(-1);

    expect(login?.search).toEqual({ redirect: "/dashboard" });
  });

  it("keeps a composed plugin route's ssr, loaderDeps, search middlewares, context, params and caching options", async () => {
    const loaderDeps = ({ search }: { search: { page: number } }) => ({ page: search.page });
    const middleware = ({ search, next }: { search: unknown; next: (s: unknown) => unknown }) =>
      next(search);
    const context = () => ({ fromContext: true });
    const params = { parse: (raw: Record<string, string>) => raw };
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public")],
      optionsById: { _public: { ssr: "data-only" } },
    };
    const auth: TestPlugin = {
      key: "auth",
      routes: [route("_public/login", "/login")],
      optionsById: {
        "_public/login": {
          ssr: false,
          loaderDeps,
          search: { middlewares: [middleware] },
          context,
          params,
          staleTime: 1000,
          gcTime: 2000,
          preloadStaleTime: 3000,
          pendingMs: 100,
          pendingMinMs: 200,
          shouldReload: false,
        },
      },
    };

    const tree = await construct([core, auth]);
    const mount = (tree.rootRoute as unknown as { children: Array<Record<string, any>> })
      .children[0]!;
    const login = mount.children[0]!;
    expect(mount.options.ssr).toBe("data-only");
    expect(login.options).toMatchObject({
      ssr: false,
      loaderDeps,
      search: { middlewares: [middleware] },
      context,
      params,
      staleTime: 1000,
      gcTime: 2000,
      preloadStaleTime: 3000,
      pendingMs: 100,
      pendingMinMs: 200,
      shouldReload: false,
    });
  });

  it("carries the core's root search validation and ssr onto the root route", async () => {
    const validateSearch = (search: Record<string, unknown>) => ({
      theme: search.theme === "dark" ? "dark" : "light",
    });
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/home", "/home")],
    };

    const tree = await construct([core], { validateSearch, ssr: true });
    const router = createRouter({ routeTree: tree.rootRoute });
    const [root] = router.matchRoutes("/home", { theme: "neon" });

    expect(root?.search).toEqual({ theme: "light" });
    expect((tree.rootRoute as unknown as { options: { ssr: unknown } }).options.ssr).toBe(true);
  });

  it("rejects cross-plugin path collisions under the same mount parent", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/login", "/login", { parentId: "_public" })],
    };
    const other: TestPlugin = {
      key: "other",
      routes: [route("_public/login-clone", "/login")],
    };

    await expect(construct([core, other])).rejects.toThrow(
      /path collision: "ui" route "_public\/login" declares "\/login" which is already claimed by "other:_public\/login-clone"/,
    );
  });

  it("constructs mounts only when declared and parents cross-source routes by directory prefix", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/login", "/login", { parentId: "_public" })],
    };
    const auth: TestPlugin = {
      key: "auth",
      routes: [route("_public/about", "/about")],
    };

    const tree = await construct([core, auth]);

    const root = tree.rootRoute as unknown as { children: Array<{ options: { id: string } }> };
    expect(root.children.map((child) => child.options.id)).toEqual(["__mount_public"]);

    const mount = root.children[0] as unknown as {
      children: Array<{ options: { path: string; id: string } }>;
    };
    expect(mount.children.map((child) => child.options.path)).toEqual(["/about", "/login"]);
    expect(tree.mountCounts).toEqual({ public: 2 });
  });

  it("resolves full paths through pathless layouts, nested layouts, and index routes", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        { id: "_authenticated/_dashboard", isLayout: true, parentId: "_authenticated" },
        route("_authenticated/_dashboard/dashboard", "/dashboard", {
          parentId: "_authenticated/_dashboard",
        }),
        route("_authenticated/settings", "/settings", { parentId: "_authenticated" }),
        route("_authenticated/settings/", "/", {
          parentId: "_authenticated/settings",
          isIndex: true,
        }),
        route("_authenticated/settings/profile", "/profile", {
          parentId: "_authenticated/settings",
        }),
      ],
      optionsById: {
        "_authenticated/_dashboard/dashboard": {
          staticData: { nav: { label: "Dashboard", order: 1 } },
        },
        "_authenticated/settings/": { staticData: { nav: { label: "Settings", order: 2 } } },
        "_authenticated/settings/profile": {
          staticData: { nav: { label: "Profile", order: 3, hidden: false } },
        },
      },
    };

    const tree = await construct([core]);
    const tos = tree.nav.items.map((item) => item.to);
    expect(tos).toEqual(["/dashboard", "/settings", "/settings/profile"]);
  });

  it("derives the nav manifest with sorting, hidden skip, to override, and source fields", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        route("_authenticated/alpha", "/alpha", { parentId: "_authenticated" }),
        route("_authenticated/beta", "/beta", { parentId: "_authenticated" }),
        route("_authenticated/hidden-one", "/hidden", { parentId: "_authenticated" }),
        route("_authenticated/override", "/real-path", { parentId: "_authenticated" }),
      ],
      optionsById: {
        "_authenticated/alpha": {
          staticData: { nav: { label: "Alpha", group: "Second", order: 2 } },
        },
        "_authenticated/beta": { staticData: { nav: { label: "Beta", group: "First", order: 1 } } },
        "_authenticated/hidden-one": { staticData: { nav: { label: "Hidden", hidden: true } } },
        "_authenticated/override": {
          staticData: { nav: { label: "Override", group: "First", order: 0, to: "/custom" } },
        },
      },
    };

    const tree = await construct([core]);
    expect(tree.nav.items.map((item) => item.label)).toEqual(["Override", "Beta", "Alpha"]);
    expect(tree.nav.items.find((item) => item.label === "Override")).toMatchObject({
      to: "/custom",
      plugin: "ui",
      mount: "authenticated",
      id: "ui:_authenticated/override",
    });
    expect(tree.nav.items.find((item) => item.label === "Hidden")).toBeUndefined();
  });

  it("session gate redirects unauthenticated users with a redirect-back search param", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        route("_authenticated/settings", "/settings", { parentId: "_authenticated" }),
      ],
    };
    const tree = await construct([core]);

    const mount = (
      tree.rootRoute as unknown as { children: Array<{ options: Record<string, unknown> }> }
    ).children[0]!;
    const beforeLoad = mount.options.beforeLoad as (args: unknown) => void;

    let thrown: unknown;
    try {
      beforeLoad({ context: {}, location: { pathname: "/settings", searchStr: "" } });
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/login");
    expect((thrown as { options: { search: unknown } }).options.search).toEqual({
      redirect: "/settings",
    });

    expect(() =>
      beforeLoad({ context: { user: { id: "u1" } }, location: { pathname: "/settings" } }),
    ).not.toThrow();
  });

  it("admin gate sends anonymous users to login and non-admins home", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("admin"), route("_admin/panel", "/panel", { parentId: "_admin" })],
    };
    const tree = await construct([core]);

    const beforeLoad = (
      tree.rootRoute as unknown as { children: Array<{ options: Record<string, unknown> }> }
    ).children[0]!.options.beforeLoad as (args: unknown) => void;

    const redirectOf = (args: unknown): { to: string } | undefined => {
      try {
        beforeLoad(args);
        return undefined;
      } catch (error) {
        expect(isRedirect(error)).toBe(true);
        return (error as { options: { to: string } }).options;
      }
    };

    expect(redirectOf({ context: {}, location: { pathname: "/panel", searchStr: "" } })?.to).toBe(
      "/login",
    );
    expect(
      redirectOf({
        context: { user: { id: "u1", role: "member" } },
        location: { pathname: "/panel", searchStr: "" },
      })?.to,
    ).toBe("/");
    expect(
      redirectOf({
        context: { user: { id: "u1", role: "admin" } },
        location: { pathname: "/panel" },
      }),
    ).toBeUndefined();
  });

  it("reads the gate user from either context.user or context.session.user", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("authenticated"),
        route("_authenticated/x", "/x", { parentId: "_authenticated" }),
      ],
    };
    const tree = await construct([core]);
    const beforeLoad = (
      tree.rootRoute as unknown as { children: Array<{ options: Record<string, unknown> }> }
    ).children[0]!.options.beforeLoad as (args: unknown) => void;

    expect(() =>
      beforeLoad({ context: { session: { user: { id: "u1" } } }, location: { pathname: "/x" } }),
    ).not.toThrow();
  });

  it("rejects duplicate mount declarations across sources", async () => {
    const core: TestPlugin = { key: "ui", routes: [mountLayout("public")] };
    const other: TestPlugin = { key: "auth", routes: [mountLayout("public")] };
    await expect(construct([core, other])).rejects.toThrow(
      /mount "public" declared by multiple sources: "auth" .* and "ui"/,
    );
  });

  it("rejects org/team mounts as declared-but-unimplemented vocabulary", async () => {
    const core: TestPlugin = { key: "ui", routes: [mountLayout("org")] };
    await expect(construct([core])).rejects.toThrow(
      /mount "org" is declared vocabulary but unimplemented/,
    );
  });

  it("rejects routes outside any mount", async () => {
    const core: TestPlugin = { key: "ui", routes: [route("cli", "/cli")] };
    await expect(construct([core])).rejects.toThrow(/route "cli" in "ui" must live under a mount/);
  });

  it("rejects unresolvable parentage", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/x", "/x", { parentId: "ghost" })],
    };
    await expect(construct([core])).rejects.toThrow(/unresolvable parentage in "ui": _public\/x/);
  });

  it("passes the core's root loader/beforeLoad/head through to the root route", async () => {
    const errorComponent = () => null;
    const notFoundComponent = () => null;
    const head = (() => ({
      meta: [{ name: "core", content: "1" }],
      links: [{ rel: "stylesheet", href: "/static/css/style.css" }],
      scripts: [{ src: "/remoteEntry.js" }],
    })) as never;
    const loader = (async () => ({ runtimeConfig: { hostUrl: "https://x" } })) as never;
    const beforeLoad = (async () => ({ cspNonce: "n" })) as never;
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public")],
    };
    const auth: TestPlugin = {
      key: "auth",
      routes: [route("_public/login", "/login")],
      rootMeta: { head: (() => ({ meta: [{ name: "auth", content: "2" }] })) as never },
    };

    const tree = await construct([core, auth], {
      errorComponent,
      notFoundComponent,
      head,
      loader,
      beforeLoad,
    });
    const options = tree.rootRoute as unknown as { options: Record<string, unknown> };

    expect(options.options.errorComponent).toBe(errorComponent);
    expect(options.options.notFoundComponent).toBe(notFoundComponent);
    expect(options.options.head).toBe(head);
    expect(options.options.loader).toBe(loader);
    expect(options.options.beforeLoad).toBe(beforeLoad);

    const headResult = (head as (args: unknown) => { meta: unknown[] })({});
    expect(headResult.meta).toHaveLength(1);
    expect(headResult.links).toHaveLength(1);
    expect(headResult.scripts).toHaveLength(1);
  });

  it("digests the composition deterministically, deployment-free", async () => {
    const core: TestPlugin = {
      key: "ui",
      routes: [mountLayout("public"), route("_public/login", "/login", { parentId: "_public" })],
    };
    const first = await construct([core]);
    const second = await construct([core]);
    expect(first.digest).toBe(second.digest);

    const direct = await digestOf({
      plugins: [{ key: "ui", mfName: "ui" }],
      manifests: [first.manifests[0]],
    });
    expect(first.digest).toBe(direct);

    const changed: TestPlugin = {
      key: "ui",
      routes: [
        mountLayout("public"),
        route("_public/login", "/login", { parentId: "_public" }),
        route("_public/x", "/x"),
      ],
    };
    const third = await construct([changed]);
    expect(third.digest).not.toBe(first.digest);

    const renamed = await constructTree({
      name: "app",
      plugins: [{ key: "ui", mfName: "ui-tenant" }],
      resolve: async () => makePlugin(core),
    });
    expect(renamed.digest).not.toBe(first.digest);
  });
});
