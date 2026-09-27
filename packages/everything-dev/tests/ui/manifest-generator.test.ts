import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateUiManifest } from "every-plugin/ui/manifest-generator";
import { describe, expect, it } from "vitest";

const fixtureRoot = fileURLToPath(new URL("../fixtures/ui", import.meta.url));

async function withFixture(name: string, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "manifest-gen-"));
  try {
    await cp(path.join(fixtureRoot, name), path.join(dir, name), { recursive: true });
    await run(path.join(dir, name));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const goldenManifest = {
  name: "auth",
  manifestVersion: 1,
  routes: [
    { id: "_authenticated", isLayout: true, mount: "authenticated", file: "_authenticated.tsx" },
    { id: "_public", isLayout: true, mount: "public", file: "_public.tsx" },
    {
      id: "_authenticated/_dashboard",
      isLayout: true,
      parentId: "_authenticated",
      file: "_authenticated/_dashboard.tsx",
      isIndex: false,
    },
    {
      id: "_authenticated/settings",
      path: "/settings",
      isLayout: false,
      parentId: "_authenticated",
      file: "_authenticated/settings.tsx",
      isIndex: false,
    },
    {
      id: "_public/login",
      path: "/login",
      isLayout: false,
      parentId: "_public",
      file: "_public/login.tsx",
      isIndex: false,
    },
    {
      id: "_public/",
      path: "/",
      isLayout: false,
      parentId: "_public",
      file: "_public/index.tsx",
      isIndex: true,
    },
    {
      id: "_authenticated/_dashboard/dashboard",
      path: "/dashboard",
      isLayout: false,
      parentId: "_authenticated/_dashboard",
      file: "_authenticated/_dashboard/dashboard.tsx",
      isIndex: false,
    },
    {
      id: "_authenticated/settings/profile",
      path: "/profile",
      isLayout: false,
      parentId: "_authenticated/settings",
      file: "_authenticated/settings/profile.tsx",
      isIndex: false,
    },
    {
      id: "_authenticated/settings/",
      path: "/",
      isLayout: false,
      parentId: "_authenticated/settings",
      file: "_authenticated/settings/index.tsx",
      isIndex: true,
    },
  ],
};

describe("generateUiManifest", () => {
  it("derives mounts, parentage, and parent-relative paths from route files only", async () => {
    await withFixture("basic", async (dir) => {
      const manifest = await generateUiManifest({ workspaceRoot: dir, pluginName: "auth" });
      expect(manifest).toEqual(goldenManifest);
    });
  });

  it("writes manifest.gen.json, routeConfig.gen.ts, and the stock routeTree.gen.ts", async () => {
    await withFixture("basic", async (dir) => {
      await generateUiManifest({ workspaceRoot: dir, pluginName: "auth" });
      const manifestFile = JSON.parse(
        await readFile(path.join(dir, "src/manifest.gen.json"), "utf8"),
      );
      expect(manifestFile).toEqual(goldenManifest);

      const routeConfig = await readFile(path.join(dir, "src/routeConfig.gen.ts"), "utf8");
      expect(routeConfig).toContain('"_public/login": () => import("./routes/_public/login")');
      expect(routeConfig).toContain(
        '"_authenticated/settings/": () => import("./routes/_authenticated/settings/index")',
      );
      expect(routeConfig).toContain('import { Route as __rootRoute } from "./routes/__root"');
      expect(routeConfig).toContain(
        'import type { RouteConfigModule, RouteOptionsBundle } from "everything-dev/ui/manifest"',
      );
      expect(routeConfig).not.toContain("-ignored");

      const routeTree = await readFile(path.join(dir, "src/routeTree.gen.ts"), "utf8");
      expect(routeTree).toContain("_addFileChildren");
    });
  });

  it("supports a custom typeImport specifier for generated route configs", async () => {
    await withFixture("basic", async (dir) => {
      await generateUiManifest({ workspaceRoot: dir, pluginName: "auth", typeImport: "pkg/types" });
      const routeConfig = await readFile(path.join(dir, "src/routeConfig.gen.ts"), "utf8");
      expect(routeConfig).toContain(
        'import type { RouteConfigModule, RouteOptionsBundle } from "pkg/types"',
      );
    });
  });

  it("carries a route's search, loader-dependency, context, params, caching and ssr contract into the generated route config", async () => {
    await withFixture("route-contract", async (dir) => {
      await generateUiManifest({ workspaceRoot: dir, pluginName: "auth" });
      const generated = (await import(path.join(dir, "src/routeConfig.gen.ts"))) as {
        routeConfigLoaders: Record<string, () => Promise<Record<string, unknown>>>;
      };
      const options = await generated.routeConfigLoaders["_public/login"]!();

      const validateSearch = options.validateSearch as (s: Record<string, unknown>) => unknown;
      expect(validateSearch({ redirect: "/settings" })).toEqual({ redirect: "/settings" });
      expect(validateSearch({})).toEqual({ redirect: "/" });
      expect(options.ssr).toBe(false);
      const loaderDeps = options.loaderDeps as (a: { search: { redirect: string } }) => unknown;
      expect(loaderDeps({ search: { redirect: "/x" } })).toEqual({ redirect: "/x" });
      const [middleware] = (
        options.search as {
          middlewares: Array<(a: { search: unknown; next: (s: unknown) => unknown }) => unknown>;
        }
      ).middlewares;
      expect(middleware?.({ search: { page: 2 }, next: (next) => next })).toEqual({ page: 2 });
      expect((options.context as () => unknown)()).toEqual({ fromContext: true });
      const params = options.params as { parse: (raw: Record<string, string>) => unknown };
      expect(params.parse({ id: "7" })).toEqual({ id: "7" });
      expect(options.staleTime).toBe(1000);
      expect(options.gcTime).toBe(2000);
      expect(options.preloadStaleTime).toBe(3000);
      expect(options.pendingMs).toBe(100);
      expect(options.pendingMinMs).toBe(200);
      expect(options.shouldReload).toBe(false);
    });
  });

  it("rejects unknown mounts as a hard generation error", async () => {
    await withFixture("unknown-mount", async (dir) => {
      await expect(generateUiManifest({ workspaceRoot: dir, pluginName: "auth" })).rejects.toThrow(
        /unknown mount "_bogus".*known: public, authenticated, admin, org, team/,
      );
    });
  });

  it("rejects root-level pathed routes — every route must live under a mount", async () => {
    await withFixture("root-level-route", async (dir) => {
      await expect(generateUiManifest({ workspaceRoot: dir, pluginName: "auth" })).rejects.toThrow(
        /route "cli" .* must live under a mount/,
      );
    });
  });
});
