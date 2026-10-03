/**
 * Nav manifest derived at construction from composed routes' `staticData.nav`
 * declarations (ADR 0008). Shape-compatible with the sidebar consumption
 * surface (`ui/src/components/layout/nav-items.ts`).
 */

export interface NavItem {
  /** unique item id: `${pluginKey}:${routeId}` */
  id: string;
  label: string;
  icon?: string;
  group?: string;
  order?: number;
  /** absolute URL path — literal `$param` segments preserved */
  to: string;
  plugin: string;
  mount: string;
}

export interface NavManifest {
  items: NavItem[];
}

export interface NavDeclaration {
  label: string;
  icon?: string;
  group?: string;
  order?: number;
  to?: string;
  /** set true to expose the route as a page but omit it from the sidebar */
  hidden?: boolean;
}

export function compareNavItems(a: NavItem, b: NavItem): number {
  const groupOrder = (a.group ?? "").localeCompare(b.group ?? "");
  if (groupOrder !== 0) return groupOrder;
  if (a.order !== undefined || b.order !== undefined) {
    return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  }
  const labelOrder = a.label.localeCompare(b.label);
  if (labelOrder !== 0) return labelOrder;
  return a.id.localeCompare(b.id);
}
