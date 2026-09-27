import { describe, expect, it } from "vitest";
import { crumbsFor } from "./breadcrumbs";
import {
  buildNavItems,
  filterSidebarByArea,
  filterSidebarByRole,
  groupSidebarItems,
  isNavItemActive,
  NAV_ITEMS,
  navSlug,
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
  it("orders the sidebar as Home, Organization, Things, Admin", () => {
    const labels = filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin").map(
      (item) => item.label,
    );
    expect(labels).toEqual(["Home", "Organization", "Things", "Admin"]);
  });

  it("keeps the test ids the browser specs rely on", () => {
    const slugs = flattenSlugs(filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin"));
    expect(slugs).toEqual(
      expect.arrayContaining(["dashboard", "orgs", "things", "admin", "admin-relayer"]),
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
      expect.arrayContaining(["/admin", "/admin/relayer", "/admin/system"]),
    );
  });

  it("groups items into labelled sections", () => {
    const sections = groupSidebarItems(filterSidebarByRole(NAV_ITEMS, "admin"));
    expect(sections.map((section) => section.label)).toEqual([null, "Workspace", "Manage"]);
  });
});

describe("active state", () => {
  it("matches Home exactly", () => {
    const home = { to: "/dashboard", exact: true };
    expect(isNavItemActive(home, "/dashboard")).toBe(true);
    expect(isNavItemActive(home, "/dashboard/other")).toBe(false);
  });

  it("matches prefix routes by segment boundary", () => {
    const orgs = { to: "/orgs", activePrefixes: ["/orgs"] };
    expect(isNavItemActive(orgs, "/orgs/acme")).toBe(true);
    expect(isNavItemActive(orgs, "/orgs-acme")).toBe(false);
  });
});

describe("team area navigation", () => {
  it("shows only the active team's areas plus area-free sections", () => {
    const paths = flattenPaths(
      filterSidebarByArea(filterSidebarByRole(NAV_ITEMS, "member"), ["things"]),
    );

    expect(paths).toEqual(expect.arrayContaining(["/dashboard", "/orgs", "/things"]));
    expect(paths).not.toContain("/things/new");
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
