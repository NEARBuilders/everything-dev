import { describe, expect, it } from "vitest";
import { crumbsFor } from "./breadcrumbs";
import {
  buildNavItems,
  filterSidebarByArea,
  filterSidebarByRole,
  filterSidebarByRoutes,
  groupSidebarItems,
  isNavItemActive,
  type ManifestRoute,
  NAV_ITEMS,
  navSlug,
  routePathsFromManifest,
  type SidebarItem,
} from "./nav-items";

function flattenPaths(items: SidebarItem[]): string[] {
  return items.flatMap((item) => [item.to, ...(item.children ? flattenPaths(item.children) : [])]);
}

function flattenSlugs(items: SidebarItem[]): string[] {
  return items.flatMap((item) => [
    navSlug(item),
    ...(item.children ? flattenSlugs(item.children) : []),
  ]);
}

describe("sidebar navigation", () => {
  it("orders the sidebar as Home, About, Organization, Things, Admin", () => {
    const labels = filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin").map(
      (item) => item.label,
    );
    expect(labels).toEqual(["Home", "About", "Organization", "Things", "Admin"]);
  });

  it("keeps the test ids the browser specs rely on", () => {
    const slugs = flattenSlugs(filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin"));
    expect(slugs).toEqual(
      expect.arrayContaining(["dashboard", "about", "orgs", "things", "admin"]),
    );
  });

  it("links Organization to the active organization, falling back to the list", () => {
    const orgTo = (activeOrgSlug: string | null) =>
      buildNavItems({ activeOrgSlug }).find((item) => navSlug(item) === "orgs")?.to;
    expect(orgTo("acme")).toBe("/orgs/acme");
    expect(orgTo(null)).toBe("/orgs");
  });

  it("hides Admin from members", () => {
    expect(flattenPaths(filterSidebarByRole(NAV_ITEMS, "member"))).not.toContain("/admin");
    expect(flattenPaths(filterSidebarByRole(NAV_ITEMS, "admin"))).toEqual(
      expect.arrayContaining(["/admin", "/admin/system"]),
    );
  });

  it("groups items into labelled sections", () => {
    const sections = groupSidebarItems(filterSidebarByRole(NAV_ITEMS, "admin"));
    expect(sections.map((section) => section.label)).toEqual([null, "Workspace", "Manage"]);
  });
});

describe("route-aware filtering", () => {
  const manifestRoute = (route: Partial<ManifestRoute> & { id: string }): ManifestRoute => route;

  it("derives absolute paths from the generated manifest", () => {
    const routes: ManifestRoute[] = [
      manifestRoute({ id: "_public", isLayout: true, parentId: "__root" }),
      manifestRoute({ id: "_public/about", path: "/about", parentId: "_public" }),
      manifestRoute({ id: "_admin", isLayout: true }),
      manifestRoute({ id: "_admin/_dashboard", isLayout: true, parentId: "_admin" }),
      manifestRoute({
        id: "_admin/_dashboard/admin",
        path: "/admin",
        parentId: "_admin/_dashboard",
      }),
      manifestRoute({
        id: "_admin/_dashboard/admin/system",
        path: "/system",
        parentId: "_admin/_dashboard/admin",
      }),
      manifestRoute({
        id: "_authenticated/_dashboard/things/",
        path: "/things/",
        parentId: "_authenticated/_dashboard",
      }),
      manifestRoute({ id: "_public/", path: "/", isIndex: true, parentId: "_public" }),
    ];
    expect(routePathsFromManifest(routes)).toEqual(
      new Set(["/about", "/admin", "/admin/system", "/things"]),
    );
  });

  it("keeps every item when all routes shipped", () => {
    const full = new Set(flattenPaths(buildNavItems({ isAdmin: true })).map((to) => to));
    const filtered = filterSidebarByRoutes(buildNavItems({ isAdmin: true }), full);
    expect(filtered.map((item) => item.to)).toEqual(
      buildNavItems({ isAdmin: true }).map((item) => item.to),
    );
  });

  it("reduces to the public shell for a simple-level child", () => {
    const simpleChildPaths = new Set(["/", "/about", "/login", "/skill"]);
    const filtered = filterSidebarByRoutes(buildNavItems({ isAdmin: true }), simpleChildPaths);
    expect(filtered.map((item) => item.to)).toEqual(["/about"]);
  });

  it("drops unshipped routes and their admin children for an advanced-level child", () => {
    const advancedChildPaths = new Set([
      "/dashboard",
      "/about",
      "/orgs",
      "/things",
      "/admin",
      "/admin/system",
    ]);
    const filtered = filterSidebarByRoutes(buildNavItems({ isAdmin: true }), advancedChildPaths);
    expect(filtered.map((item) => item.to)).toEqual([
      "/dashboard",
      "/about",
      "/orgs",
      "/things",
      "/admin",
    ]);
    const admin = filtered.find((item) => item.to === "/admin");
    expect(admin?.children?.map((child) => child.to)).toEqual(["/admin", "/admin/system"]);
  });

  it("matches the organization item through its activePrefix when the link is org-scoped", () => {
    const paths = new Set(["/dashboard", "/orgs", "/about"]);
    const items = buildNavItems({ activeOrgSlug: "acme" });
    expect(filterSidebarByRoutes(items, paths).map((item) => item.to)).toContain("/orgs/acme");
  });

  it("drops parents whose children are all pruned", () => {
    const items: SidebarItem[] = [
      {
        icon: () => null,
        label: "Admin",
        to: "/admin",
        roleRequired: "admin",
        section: "manage",
        children: [
          { icon: () => null, label: "Sites", to: "/admin/tenants", roleRequired: "admin" },
        ],
      },
      { icon: () => null, label: "Build", to: "/build", roleRequired: "anon" },
    ];
    const filtered = filterSidebarByRoutes(items, new Set(["/build"]));
    expect(filtered.map((item) => item.to)).toEqual(["/build"]);
  });

  it("returns items unfiltered when the path set is empty", () => {
    const items = buildNavItems({ isAdmin: true });
    expect(filterSidebarByRoutes(items, new Set())).toEqual(items);
  });
});

describe("active state", () => {
  it("matches Home exactly so nested dashboard paths are not also Home", () => {
    const home = { to: "/dashboard", exact: true };
    expect(isNavItemActive(home, "/dashboard")).toBe(true);
    expect(isNavItemActive(home, "/dashboard/nested")).toBe(false);
  });

  it("tells tabbed pages apart by search", () => {
    const events = { to: "/n1/content", search: { tab: "events" } };
    const onboarding = { to: "/n1/content", search: { tab: "onboarding" } };
    expect(isNavItemActive(events, "/n1/content", {})).toBe(true);
    expect(isNavItemActive(onboarding, "/n1/content", {})).toBe(false);
    expect(isNavItemActive(onboarding, "/n1/content", { tab: "onboarding" })).toBe(true);
  });
});

describe("team area navigation", () => {
  it("shows only the active team's areas plus area-free sections", () => {
    const paths = flattenPaths(
      filterSidebarByArea(filterSidebarByRole(NAV_ITEMS, "member"), ["stake"]),
    );

    expect(paths).toEqual(expect.arrayContaining(["/dashboard", "/about", "/orgs"]));
    expect(paths).not.toContain("/things");
  });

  it("leaves navigation untouched when unrestricted", () => {
    const member = filterSidebarByRole(NAV_ITEMS, "member");

    expect(filterSidebarByArea(member, null)).toEqual(member);
  });
});

describe("breadcrumbs", () => {
  const labels = (pathname: string) => crumbsFor(pathname).map((crumb) => crumb.label);

  it("names pages instead of echoing path segments", () => {
    expect(labels("/dashboard")).toEqual(["Home"]);
    expect(labels("/settings/api-keys")).toEqual(["Settings", "API keys"]);
    expect(labels("/admin/system")).toEqual(["Admin", "System"]);
  });

  it("uses the organization name when it is known", () => {
    expect(
      crumbsFor("/orgs/acme", { orgName: (slug) => (slug === "acme" ? "Acme Co" : undefined) }),
    ).toEqual([{ label: "Organizations", to: "/orgs" }, { label: "Acme Co" }]);
  });

  it("links parent crumbs", () => {
    expect(crumbsFor("/things/new")[0]).toEqual({ label: "Things", to: "/things" });
  });
});
