import {
  BankIcon,
  BuildingsIcon,
  ChartBarIcon,
  CoinsIcon,
  CompassIcon,
  CubeIcon,
  HouseIcon,
  LightningIcon,
  ListChecksIcon,
  NetworkIcon,
  PlusCircleIcon,
  ScrollIcon,
  ShieldIcon,
  SparkleIcon,
  TreeStructureIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import type { FeatureArea } from "@/lib/feature-areas";

export type SidebarRole = "anon" | "member" | "admin";

export type SidebarSection = "main" | "organization" | "manage";

interface NavManifestItem {
  label: string;
  icon?: string;
  group?: string;
  order?: number;
  to: string;
  mount: string;
}

export interface SidebarItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  roleRequired: SidebarRole;
  slug?: string;
  search?: Record<string, string>;
  exact?: boolean;
  activePrefixes?: string[];
  area?: FeatureArea;
  children?: SidebarItem[];
  section?: SidebarSection;
  group?: string;
  order?: number;
}

export interface NavContext {
  activeOrgSlug?: string | null;
  canManageOrganization?: boolean;
  canCurate?: boolean;
  isAdmin?: boolean;
}

const ADMIN_CHILDREN: SidebarItem[] = [
  {
    icon: ChartBarIcon,
    label: "Overview",
    slug: "admin-overview",
    to: "/admin",
    exact: true,
    roleRequired: "admin",
  },
  {
    icon: NetworkIcon,
    label: "Communities",
    slug: "admin-nodes",
    to: "/admin/nodes",
    roleRequired: "admin",
  },
  {
    icon: ScrollIcon,
    label: "Proposals",
    slug: "admin-proposals",
    to: "/admin/proposals",
    roleRequired: "admin",
  },
  {
    icon: TreeStructureIcon,
    label: "Sites",
    slug: "admin-tenants",
    to: "/admin/tenants",
    roleRequired: "admin",
  },
  {
    icon: LightningIcon,
    label: "Relayer",
    slug: "admin-relayer",
    to: "/admin/relayer",
    roleRequired: "admin",
  },
  {
    icon: WrenchIcon,
    label: "System",
    slug: "admin-system",
    to: "/admin/system",
    roleRequired: "admin",
  },
];

export function buildNavItems(context: NavContext = {}): SidebarItem[] {
  const orgPath = context.activeOrgSlug ? `/orgs/${context.activeOrgSlug}` : "/orgs";
  return [
    {
      icon: HouseIcon,
      label: "Home",
      slug: "dashboard",
      to: "/dashboard",
      exact: true,
      roleRequired: "member",
      section: "main",
    },
    {
      icon: CompassIcon,
      label: "Explore",
      slug: "explore",
      to: "/explore",
      activePrefixes: ["/explore", "/n/", "/activity/"],
      roleRequired: "anon",
      section: "main",
    },
    {
      icon: CoinsIcon,
      label: "Stake",
      slug: "stake",
      to: "/stake",
      roleRequired: "anon",
      area: "stake",
      section: "main",
    },
    {
      icon: NetworkIcon,
      label: "My community",
      slug: "my-node",
      to: "/dashboard/node",
      activePrefixes: ["/dashboard/node", "/nodes/", "/tenant/"],
      roleRequired: "member",
      area: "node-operations",
      section: "organization",
    },
    {
      icon: BuildingsIcon,
      label: "Organization",
      slug: "orgs",
      to: orgPath,
      activePrefixes: ["/orgs"],
      roleRequired: "member",
      section: "organization",
    },
    {
      icon: CubeIcon,
      label: "Things",
      slug: "things",
      to: "/things",
      roleRequired: "member",
      area: "things",
      section: "organization",
    },
    ...(context.canCurate || context.isAdmin
      ? [
          {
            icon: ListChecksIcon,
            label: "Directory",
            slug: "discover",
            to: "/discover",
            roleRequired: "member" as const,
            section: "manage" as const,
          },
        ]
      : []),
    {
      icon: ShieldIcon,
      label: "Admin",
      slug: "admin",
      to: "/admin",
      roleRequired: "admin",
      section: "manage",
      children: ADMIN_CHILDREN,
    },
  ];
}

export const NAV_ITEMS: SidebarItem[] = buildNavItems({ canCurate: true });

export function navSlug(item: Pick<SidebarItem, "slug" | "label">) {
  return item.slug ?? item.label.toLowerCase().replace(/\s+/g, "-");
}

export function isNavItemActive(
  item: Pick<SidebarItem, "to" | "exact" | "activePrefixes" | "search">,
  pathname: string,
  search: Record<string, unknown> = {},
): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (item.search) {
    if (normalized !== item.to) return false;
    const current = typeof search.tab === "string" ? search.tab : undefined;
    const wanted = item.search.tab;
    return current === wanted || (current === undefined && wanted === "events");
  }
  if (normalized === item.to) return true;
  if (item.exact) return false;
  const prefixes = item.activePrefixes ?? [item.to];
  return prefixes.some(
    (prefix) =>
      prefix !== "/" &&
      (normalized === prefix ||
        normalized.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)),
  );
}

export function getUserRole(isAuthenticated: boolean, isAdmin: boolean): SidebarRole {
  if (isAdmin) return "admin";
  if (isAuthenticated) return "member";
  return "anon";
}

export function filterSidebarByRole(items: SidebarItem[], userRole: SidebarRole): SidebarItem[] {
  const matchesRole = (role: SidebarRole) => {
    if (role === "anon") return true;
    if (role === "member" && userRole !== "anon") return true;
    if (role === "admin" && userRole === "admin") return true;
    return false;
  };

  const filterChildren = (item: SidebarItem): SidebarItem | null => {
    if (!matchesRole(item.roleRequired)) return null;
    if (!item.children) return item;
    const children = item.children
      .map(filterChildren)
      .filter((child): child is SidebarItem => child !== null);
    if (children.length === 0) return null;
    return { ...item, children };
  };

  return items.map(filterChildren).filter((item): item is SidebarItem => item !== null);
}

export function filterSidebarByArea(
  items: SidebarItem[],
  allowedAreas: readonly FeatureArea[] | null,
): SidebarItem[] {
  if (!allowedAreas) return items;
  const visible = (item: SidebarItem): SidebarItem | null => {
    if (item.area && !allowedAreas.includes(item.area)) return null;
    if (!item.children) return item;
    const children = item.children
      .map(visible)
      .filter((child): child is SidebarItem => child !== null);
    return { ...item, children };
  };
  return items.map(visible).filter((item): item is SidebarItem => item !== null);
}

const PLUGIN_ICON_MAP: Record<string, SidebarItem["icon"]> = {
  compass: CompassIcon,
  sparkles: SparkleIcon,
  boxes: CubeIcon,
  home: HouseIcon,
  network: NetworkIcon,
  landmark: BankIcon,
  building2: BuildingsIcon,
  shield: ShieldIcon,
  "circle-plus": PlusCircleIcon,
};

export function pluginNavToSidebar(items: NavManifestItem[]): SidebarItem[] {
  return items
    .filter((item) => Boolean(item.label))
    .map((item, index) => ({
      icon: PLUGIN_ICON_MAP[item.icon ?? "boxes"] ?? CubeIcon,
      label: item.label,
      to: item.to,
      roleRequired: (item.mount === "public" || item.mount === "anon"
        ? "anon"
        : "member") as SidebarRole,
      group: item.group,
      order: item.order ?? index,
    }));
}

export function appendPluginSidebarItems(
  builtin: SidebarItem[],
  plugin: SidebarItem[],
): SidebarItem[] {
  const builtinTos = new Set(builtin.map((item) => item.to));
  return [...builtin, ...plugin.filter((item) => !builtinTos.has(item.to))];
}

export const SECTION_LABELS: Record<SidebarSection, string | null> = {
  main: null,
  organization: "Workspace",
  manage: "Manage",
};

export function groupSidebarItems(items: SidebarItem[]) {
  const sections: Array<{ key: string; label: string | null; items: SidebarItem[] }> = [];
  for (const item of items) {
    const key = item.section ?? item.group ?? "more";
    const label =
      item.section !== undefined ? SECTION_LABELS[item.section] : (item.group ?? "More");
    const existing = sections.find((section) => section.key === key);
    if (existing) existing.items.push(item);
    else sections.push({ key, label, items: [item] });
  }
  return sections;
}
