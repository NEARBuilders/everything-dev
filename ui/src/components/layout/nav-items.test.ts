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
  it("orders the sidebar as Home, Explore, Stake, My community, Organization, Things, Directory, Admin", () => {
    const labels = filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin").map(
      (item) => item.label,
    );
    expect(labels).toEqual([
      "Home",
      "Explore",
      "Stake",
      "My community",
      "Organization",
      "Things",
      "Directory",
      "Admin",
    ]);
  });

  it("keeps the test ids the browser specs rely on", () => {
    const slugs = flattenSlugs(filterSidebarByRole(buildNavItems({ isAdmin: true }), "admin"));
    expect(slugs).toEqual(
      expect.arrayContaining([
        "dashboard",
        "explore",
        "stake",
        "my-node",
        "orgs",
        "things",
        "discover",
        "admin",
      ]),
    );
  });

  it("shows Directory only to curators and admins", () => {
    const member = (canCurate: boolean) =>
      filterSidebarByRole(buildNavItems({ canCurate }), "member").map((item) => item.to);
    expect(member(false)).not.toContain("/discover");
    expect(member(true)).toContain("/discover");
  });

  it("links Organization to the active organization, falling back to the list", () => {
    const orgTo = (activeOrgSlug: string | null) =>
      buildNavItems({ activeOrgSlug }).find((item) => navSlug(item) === "orgs")?.to;
    expect(orgTo("acme")).toBe("/orgs/acme");
    expect(orgTo(null)).toBe("/orgs");
  });

  it("keeps My community a single link; its sections live in the page tabs", () => {
    const myCommunity = buildNavItems({}).find((item) => navSlug(item) === "my-node");
    expect(myCommunity?.to).toBe("/dashboard/node");
    expect(myCommunity?.children).toBeUndefined();
    expect(isNavItemActive(myCommunity ?? { to: "" }, "/nodes/abc/content")).toBe(true);
    expect(isNavItemActive(myCommunity ?? { to: "" }, "/tenant/t1")).toBe(true);
  });

  it("hides Admin from members", () => {
    expect(flattenPaths(filterSidebarByRole(NAV_ITEMS, "member"))).not.toContain("/admin");
    expect(flattenPaths(filterSidebarByRole(NAV_ITEMS, "admin"))).toEqual(
      expect.arrayContaining(["/admin", "/admin/nodes", "/admin/relayer", "/admin/system"]),
    );
  });

  it("groups items into labelled sections", () => {
    const sections = groupSidebarItems(filterSidebarByRole(NAV_ITEMS, "admin"));
    expect(sections.map((section) => section.label)).toEqual([null, "Workspace", "Manage"]);
  });
});

describe("active state", () => {
  it("matches Home exactly so My community is not also Home", () => {
    const home = { to: "/dashboard", exact: true };
    expect(isNavItemActive(home, "/dashboard")).toBe(true);
    expect(isNavItemActive(home, "/dashboard/node")).toBe(false);
  });

  it("treats public community pages as Explore", () => {
    const explore = { to: "/explore", activePrefixes: ["/explore", "/n/", "/activity/"] };
    expect(isNavItemActive(explore, "/n/brooklyn")).toBe(true);
    expect(isNavItemActive(explore, "/stake")).toBe(false);
  });

  it("tells Events & profile and Onboarding apart by tab", () => {
    const events = { to: "/nodes/n1/content", search: { tab: "events" } };
    const onboarding = { to: "/nodes/n1/content", search: { tab: "onboarding" } };
    expect(isNavItemActive(events, "/nodes/n1/content", {})).toBe(true);
    expect(isNavItemActive(onboarding, "/nodes/n1/content", {})).toBe(false);
    expect(isNavItemActive(onboarding, "/nodes/n1/content", { tab: "onboarding" })).toBe(true);
  });
});

describe("team area navigation", () => {
  it("shows only the active team's areas plus area-free sections", () => {
    const paths = flattenPaths(
      filterSidebarByArea(filterSidebarByRole(NAV_ITEMS, "member"), ["stake"]),
    );

    expect(paths).toEqual(expect.arrayContaining(["/explore", "/dashboard", "/stake", "/orgs"]));
    expect(paths).not.toContain("/dashboard/node");
    expect(paths).not.toContain("/things");
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
    expect(labels("/discover")).toEqual(["Directory"]);
    expect(labels("/dashboard/node/proposals")).toEqual(["My community", "Proposals"]);
    expect(labels("/nodes/abc/content")).toEqual(["My community", "Events & profile"]);
    expect(
      crumbsFor("/nodes/abc/content", { tab: "onboarding" }).map((crumb) => crumb.label),
    ).toEqual(["My community", "Onboarding"]);
    expect(labels("/tenant/t1")).toEqual(["My community", "Community settings"]);
    expect(labels("/settings/api-keys")).toEqual(["Settings", "API keys"]);
    expect(labels("/admin/tenants/new")).toEqual(["Admin", "Sites", "New site"]);
    expect(labels("/apply")).toEqual(["Start a community"]);
  });

  it("uses the organization name when it is known", () => {
    expect(
      crumbsFor("/orgs/acme", { orgName: (slug) => (slug === "acme" ? "Acme Co" : undefined) }),
    ).toEqual([{ label: "Organizations", to: "/orgs" }, { label: "Acme Co" }]);
  });

  it("names focused form and detail pages under their parent", () => {
    expect(crumbsFor("/nodes/abc/events/new")).toEqual([
      { label: "My community", to: "/dashboard/node" },
      { label: "Events & profile", to: "/nodes/abc/content" },
      { label: "New event" },
    ]);
    expect(labels("/nodes/abc/events/e1/edit")).toEqual([
      "My community",
      "Events & profile",
      "Edit event",
    ]);
    expect(crumbsFor("/dashboard/node/proposals/p1")).toEqual([
      { label: "My community", to: "/dashboard/node" },
      { label: "Proposals", to: "/dashboard/node/proposals" },
      { label: "Proposal" },
    ]);
    expect(crumbsFor("/admin/nodes/n1/edit")).toEqual([
      { label: "Admin", to: "/admin" },
      { label: "Communities", to: "/admin/nodes" },
      { label: "Community", to: "/admin/nodes/n1" },
      { label: "Edit community" },
    ]);
  });

  it("links parent crumbs", () => {
    expect(crumbsFor("/things/new")[0]).toEqual({ label: "Things", to: "/things" });
  });
});
