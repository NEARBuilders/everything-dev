import { isPlainObject } from "./resolution/merge";

/**
 * The one app/plugins config-slot walker — every consumer that names config
 * slots (pin verification, release-slot records, deploy-state keys, slot
 * stamps, authorship checks, pointer fingerprints) derives its traversal from
 * here so the dotted-slot-path domain cannot fork per module into silently
 * divergent copies (coding-standards: a hand-maintained constant paralleling
 * what the config schema knows is a driftable copy).
 *
 * Canonical dotted paths: `app.<key>`, `app.<key>.ui`, `plugins.<id>`,
 * `plugins.<id>.ui`. A `ui: false` opt-out is visited (the entry owns the
 * no-surface decision); a bare-string plugin ref is visited with
 * `isPluginRef` true (it owns the plugin and its whole ui surface).
 */

export interface ConfigSlot {
  slot: string;
  entry: Record<string, unknown> | string | false;
  readonly isPluginRef: boolean;
}

export function walkConfigSlots(
  config: Record<string, unknown>,
  visit: (slot: ConfigSlot) => void,
): void {
  const app = config.app;
  if (isPlainObject(app)) {
    for (const [key, entry] of Object.entries(app)) {
      if (!isPlainObject(entry)) continue;
      visit({ slot: `app.${key}`, entry, isPluginRef: false });
      if ("ui" in entry) {
        const ui = (entry as Record<string, unknown>).ui;
        if (isPlainObject(ui) || ui === false) {
          visit({ slot: `app.${key}.ui`, entry: ui, isPluginRef: false });
        }
      }
    }
  }
  const plugins = config.plugins;
  if (isPlainObject(plugins)) {
    for (const [id, entry] of Object.entries(plugins)) {
      if (typeof entry === "string") {
        if (entry.length > 0) {
          visit({ slot: `plugins.${id}`, entry, isPluginRef: true });
        }
        continue;
      }
      if (!isPlainObject(entry)) continue;
      visit({ slot: `plugins.${id}`, entry, isPluginRef: false });
      if ("ui" in entry) {
        const ui = entry.ui;
        if (isPlainObject(ui) || ui === false) {
          visit({ slot: `plugins.${id}.ui`, entry: ui, isPluginRef: false });
        }
      }
    }
  }
}

/**
 * Ensure every container of a dotted path exists (creating plain objects along
 * the way) and return the container that holds the final segment. Consumers
 * keep the final-set semantics (replace vs merge-into) local.
 */
export function ensureObjectContainers(
  target: Record<string, unknown>,
  segments: readonly string[],
): Record<string, unknown> {
  let container = target;
  for (const segment of segments) {
    const next = container[segment];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      container[segment] = created;
      container = created;
    } else {
      container = next;
    }
  }
  return container;
}
