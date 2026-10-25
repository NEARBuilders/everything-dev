import { createDefu } from "defu";
import type { BosConfigInput, ExtendsConfig } from "../../types";

export const BOS_CONFIG_ORDER = [
  "extends",
  "account",
  "domain",
  "title",
  "description",
  "testnet",
  "staging",
  "repository",
  "publish",
  "platform",
  "ci",
  "app",
  "plugins",
  "rolledBackFrom",
] as const;

export type BosConfigFieldName = (typeof BOS_CONFIG_ORDER)[number];

export type BosEnv = "development" | "production" | "staging";

export interface ResolvedConfigMeta {
  env: BosEnv;
  resolvedAt: string;
  extendsChain: string[];
  source?: string;
}

const ARRAY_UNION_KEYS = new Set(["secrets", "connectSrc"]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unionArrays(a: unknown, b: unknown): unknown[] | undefined {
  const aArr = Array.isArray(a) ? a : [];
  const bArr = Array.isArray(b) ? b : [];
  if (aArr.length === 0 && bArr.length === 0) return undefined;
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of [...aArr, ...bArr]) {
    if (typeof item === "string") {
      if (seen.has(item)) continue;
      seen.add(item);
    }
    result.push(item);
  }
  return result;
}

function cleanNullSentinels(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (isPlainObject(value)) {
      const cleaned = cleanNullSentinels(value);
      if (Object.keys(cleaned).length > 0) {
        out[key] = cleaned;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bosConfigMerger = createDefu((obj: any, key: any, value: any): boolean | undefined => {
  if (key === "pin") {
    // the pin is an atomic unit — a child pin replaces the parent's whole
    // (per-key defu merging would half-mix manifest/integrity across runtimes)
    obj[key] = value;
    return true;
  }
  if (obj[key] === null) return true;
  if (value === null) {
    obj[key] = null;
    return true;
  }
  if (Array.isArray(obj[key]) && Array.isArray(value)) {
    if (ARRAY_UNION_KEYS.has(key)) {
      obj[key] = unionArrays(obj[key], value);
    } else {
      obj[key] = value;
    }
    return true;
  }
  return false;
});

export function resolveExtendsRef(
  extendsField: string | ExtendsConfig | undefined,
  env: BosEnv,
): string | undefined {
  if (!extendsField) return undefined;
  if (typeof extendsField === "string") return extendsField;
  return extendsField[env] ?? extendsField.production ?? Object.values(extendsField).find(Boolean);
}

export function mergeBosConfigWithExtends(
  parent: BosConfigInput,
  child: BosConfigInput,
): BosConfigInput {
  const merged = bosConfigMerger(child, parent) as BosConfigInput;

  if (child.plugins !== undefined && isPlainObject(child.plugins)) {
    (merged as Record<string, unknown>).plugins = cleanNullSentinels(
      child.plugins as Record<string, unknown>,
    );
  }

  const mergedRecord = merged as Record<string, unknown>;

  if (isPlainObject(mergedRecord.app)) {
    for (const entryVal of Object.values(mergedRecord.app as Record<string, unknown>)) {
      if (!isPlainObject(entryVal)) continue;
      for (const secretKey of ARRAY_UNION_KEYS) {
        if (Array.isArray(entryVal[secretKey])) {
          entryVal[secretKey] =
            (unionArrays(entryVal[secretKey] as unknown[], []) as string[] | undefined)?.filter(
              Boolean,
            ) ?? entryVal[secretKey];
        }
      }
    }
  }

  if (isPlainObject(mergedRecord.plugins)) {
    for (const pluginVal of Object.values(mergedRecord.plugins as Record<string, unknown>)) {
      if (!isPlainObject(pluginVal)) continue;
      for (const secretKey of ARRAY_UNION_KEYS) {
        if (Array.isArray(pluginVal[secretKey])) {
          pluginVal[secretKey] =
            (unionArrays(pluginVal[secretKey] as unknown[], []) as string[] | undefined)?.filter(
              Boolean,
            ) ?? pluginVal[secretKey];
        }
      }
    }
  }

  return rebuildOrderedConfig(mergedRecord) as BosConfigInput;
}

export function mergeBosConfigWithTemplate(
  local: BosConfigInput,
  template: BosConfigInput,
): BosConfigInput {
  const merged = mergeJsonValuesPreservingLocalOrder(local, template) as BosConfigInput;
  return rebuildOrderedConfig(merged as Record<string, unknown>) as BosConfigInput;
}

function mergeJsonValuesPreservingLocalOrder(local: unknown, template: unknown): unknown {
  if (isPlainObject(local) && isPlainObject(template)) {
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(local)) {
      merged[key] = mergeJsonValuesPreservingLocalOrder(
        local[key],
        (template as Record<string, unknown>)[key],
      );
    }
    for (const key of Object.keys(template as Record<string, unknown>)) {
      if (!(key in merged)) {
        merged[key] = (template as Record<string, unknown>)[key];
      }
    }
    return merged;
  }
  return local ?? template;
}

export function rebuildOrderedConfig<T extends Record<string, unknown>>(config: T): T {
  const ordered: Record<string, unknown> = {};

  for (const key of BOS_CONFIG_ORDER) {
    if (key in config) {
      ordered[key] = config[key];
    }
  }

  for (const key of Object.keys(config)) {
    if (!BOS_CONFIG_ORDER.includes(key as BosConfigFieldName)) {
      ordered[key] = config[key];
    }
  }

  return ordered as T;
}

/**
 * Deep child-wins merge used to overlay a freshly authored config on top of
 * the currently published one — authored keys win, published-only pipeline
 * state (bundle URLs, integrity) is preserved. Unlike the extends merge,
 * plugin entries merge per-key so published URLs survive authored edits;
 * removing a slot from the authored config therefore requires a deploy,
 * which regenerates the payload from scratch.
 */
export function mergeAuthoredOverPublished(
  published: BosConfigInput,
  authored: BosConfigInput,
): BosConfigInput {
  const merged = mergeJsonValuesPreservingLocalOrder(authored, published) as Record<
    string,
    unknown
  >;
  return rebuildOrderedConfig(merged) as BosConfigInput;
}

export { bosConfigMerger };

const isLocalRef = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("local:");

/** A config entry (app slot or plugin attachment) with its workspace-relative
 * `local:` development targets removed — sub-slot `ui` included. */
function stripLocalTargetsFromEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const next = { ...entry };
  if (isLocalRef(next.development)) delete next.development;
  const ui = next.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui === "object" && isLocalRef(ui.development)) {
    const strippedUi = { ...ui };
    delete strippedUi.development;
    next.ui = strippedUi;
  }
  return next;
}

/**
 * Publish canonicalization (#584): a `local:` development target is
 * workspace-relative and meaningful only in the repo that declares the
 * workspace — a child inheriting one cannot spawn it. The authoring surface
 * (the parent's own `bos.app.ts`) keeps them for the parent's own dev; the
 * published payload carries only consumable targets, so `extends` never
 * hands a child a `local:` ref. The runtime's production fallback
 * (`resolveDevelopmentTarget`) resolves the slot from its published URL.
 */
export function stripLocalDevelopmentTargets<T extends object>(config: T): T {
  const out = { ...config } as Record<string, unknown>;
  const app = out.app as Record<string, Record<string, unknown>> | undefined;
  if (app && typeof app === "object") {
    const nextApp: Record<string, unknown> = { ...app };
    for (const key of ["host", "ui", "api", "auth"] as const) {
      const entry = app[key];
      if (entry && typeof entry === "object") nextApp[key] = stripLocalTargetsFromEntry(entry);
    }
    out.app = nextApp;
  }
  const plugins = out.plugins as Record<string, unknown> | undefined;
  if (plugins && typeof plugins === "object") {
    const nextPlugins: Record<string, unknown> = { ...plugins };
    for (const [id, raw] of Object.entries(plugins)) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        nextPlugins[id] = stripLocalTargetsFromEntry(raw as Record<string, unknown>);
      }
    }
    out.plugins = nextPlugins;
  }
  return out as T;
}
