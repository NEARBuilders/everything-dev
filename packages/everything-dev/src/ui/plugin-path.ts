/**
 * Escape hatch for navigation to plugin-owned paths. Composed plugin routes
 * are not part of the core Register, so literal paths to them fail TanStack's
 * strict Link/redirect typing even though they resolve at runtime once the
 * plugin tree composes in. Routing the literal through a string-typed
 * boundary states the contract explicitly: the path is valid only while the
 * owning plugin ui is composed in — core-only fallbacks 404 by design.
 */
export function pluginPath(path: string): string {
  return path;
}

/**
 * Plugin-owned href with query params — usable via the `href` option of
 * Link/Navigate/redirect when the path's search schema lives in the plugin
 * (the core cannot type-check it).
 */
export function pluginHref(path: string, search?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return `${pluginPath(path)}${query ? `?${query}` : ""}`;
}

/**
 * Search params for a plugin-owned route used through the typed `search`
 * option — the core cannot type-check them, so they widen to the router's
 * full search schema union.
 */
export function pluginSearch(search: Record<string, unknown>): never {
  return search as never;
}
