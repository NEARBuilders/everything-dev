import { createDefu } from "defu";
import type { BosConfigInput, ExtendsConfig } from "./types";

export const BOS_CONFIG_ORDER = [
  "extends",
  "account",
  "domain",
  "title",
  "description",
  "testnet",
  "staging",
  "repository",
  "ci",
  "app",
  "plugins",
  "shared",
] as const;

export type BosConfigFieldName = (typeof BOS_CONFIG_ORDER)[number];

export type BosEnv = "development" | "production" | "staging";

export interface ResolvedConfigMeta {
  env: BosEnv;
  resolvedAt: string;
  extendsChain: string[];
  source?: string;
}

const ARRAY_UNION_KEYS = new Set(["secrets"]);

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
  const { plugins: _ignoredParentPlugins, ...parentWithoutPlugins } = parent;
  const merged = bosConfigMerger(child, parentWithoutPlugins) as BosConfigInput;

  if (child.plugins !== undefined && isPlainObject(child.plugins)) {
    (merged as Record<string, unknown>).plugins = cleanNullSentinels(
      child.plugins as Record<string, unknown>,
    );
  } else {
    delete (merged as Record<string, unknown>).plugins;
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

export { bosConfigMerger };
