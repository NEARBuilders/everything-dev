import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ATTACHMENT_FIELDS,
  configInputToDescriptor,
  PLUGIN_ATTACHMENT_FIELDS,
} from "../../descriptor/resolve";
import {
  LEGACY_JSON_CONFIG_MESSAGE,
  loadAppDescriptorConfig,
  loadInProcessDescriptor,
} from "../resolution/load";

const PIPELINE_FIELDS = ["production", "integrity", "ssr", "ssrIntegrity", "digest"] as const;

const TOP_LEVEL_FIELDS = new Set([
  "extends",
  "account",
  "domain",
  "title",
  "description",
  "repository",
  "testnet",
  "release",
  "platform",
  "staging",
  "starter",
  "ci",
  "cdn",
  "publish",
  "seed",
  "app",
  "plugins",
]);

const SLOT_FIELDS: Record<string, ReadonlySet<string>> = {
  host: new Set(["development", "secrets"]),
  ui: new Set(["development"]),
  api: new Set(["development", "proxy", "variables", "secrets", "routes", "shared", "dependsOn"]),
};

const ENTRY_FIELDS = new Set([
  ...ATTACHMENT_FIELDS,
  ...PLUGIN_ATTACHMENT_FIELDS,
  "development",
  "extends",
]);

const UI_ENTRY_FIELDS = new Set(["name", "development", "integrity", "digest"]);

const targetedRef = (ref: string, key: string): string =>
  ref.includes("#") ? ref : `${ref}#plugins.${key}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Translation {
  input: Record<string, unknown>;
  unmapped: string[];
}

function translateEntry(key: string, entry: Record<string, unknown>, base: Translation): void {
  for (const field of Object.keys(entry)) {
    if (ENTRY_FIELDS.has(field)) continue;
    if (PIPELINE_FIELDS.includes(field as (typeof PIPELINE_FIELDS)[number])) continue;
    base.unmapped.push(`plugins.${key}.${field}`);
  }

  const hasPipelineField = PIPELINE_FIELDS.some(
    (field) => (entry as Record<string, unknown>)[field] !== undefined,
  );
  if (hasPipelineField) {
    const ref =
      typeof entry.extends === "string"
        ? entry.extends
        : typeof base.input.extends === "string"
          ? (base.input.extends as string)
          : undefined;
    if (ref === undefined) {
      base.unmapped.push(
        `plugins.${key}.production (no extends ref to target — cannot express a remote-only plugin without a registry source)`,
      );
    } else {
      entry.extends = targetedRef(ref, key);
    }
    for (const field of PIPELINE_FIELDS) delete entry[field];
  }

  const ui = entry.ui;
  if (isPlainObject(ui)) {
    for (const field of Object.keys(ui)) {
      if (UI_ENTRY_FIELDS.has(field)) continue;
      base.unmapped.push(`plugins.${key}.ui.${field}`);
    }
  }
}

function translateForDescriptor(source: Record<string, unknown>): Record<string, unknown> {
  const input = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  const base: Translation = { input, unmapped: [] };

  for (const field of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.has(field)) base.unmapped.push(field);
  }

  const app = input.app;
  if (isPlainObject(app)) {
    for (const [slot, entry] of Object.entries(app)) {
      if (slot === "auth") {
        if (isPlainObject(entry)) {
          for (const field of Object.keys(entry)) {
            if (ENTRY_FIELDS.has(field)) continue;
            if (PIPELINE_FIELDS.includes(field as (typeof PIPELINE_FIELDS)[number])) {
              base.unmapped.push(`app.auth.${field} (the auth slot has no extends targeting)`);
              continue;
            }
            base.unmapped.push(`app.auth.${field}`);
          }
        }
        continue;
      }
      const allowed = SLOT_FIELDS[slot];
      if (!allowed) {
        base.unmapped.push(`app.${slot}`);
        continue;
      }
      if (!isPlainObject(entry)) continue;
      for (const field of Object.keys(entry)) {
        if (allowed.has(field)) continue;
        if (PIPELINE_FIELDS.includes(field as (typeof PIPELINE_FIELDS)[number])) {
          base.unmapped.push(`app.${slot}.${field} (the ${slot} slot has no remote form)`);
          continue;
        }
        base.unmapped.push(`app.${slot}.${field}`);
      }
    }
  }

  const plugins = input.plugins;
  if (isPlainObject(plugins)) {
    for (const [key, entry] of Object.entries(plugins)) {
      if (typeof entry === "string") continue;
      if (!isPlainObject(entry)) {
        base.unmapped.push(`plugins.${key} (not an object or string ref)`);
        continue;
      }
      translateEntry(key, entry, base);
    }
  }

  if (base.unmapped.length > 0) {
    throw new Error(
      `cannot auto-convert bos.config.json — these fields have no bos.app.ts descriptor equivalent:\n  ${base.unmapped.join("\n  ")}\nConvert the config by hand (bos.app.ts), then re-run. ${LEGACY_JSON_CONFIG_MESSAGE}`,
    );
  }

  return input;
}

export interface LegacyJsonConfigConversion {
  status: "absent" | "already-descriptor" | "converted";
}

/**
 * The upgrade train's pre-conversion read: the authored descriptor when
 * present, else the legacy `bos.config.json` parsed directly (bypassing the
 * read funnels that refuse the legacy form). Only upgrade-train code may
 * call this — everything else fails loud at the read boundary.
 */
export async function readAuthoredOrLegacyJsonConfig(
  projectDir: string,
): Promise<Record<string, unknown> | null> {
  const appPath = join(projectDir, "bos.app.ts");
  if (existsSync(appPath)) {
    return (await loadAppDescriptorConfig(appPath)) as unknown as Record<string, unknown>;
  }
  const jsonPath = join(projectDir, "bos.config.json");
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
  }
  return null;
}

/**
 * The upgrade migration leg retiring the JSON authored-config form: converts
 * a committed `bos.config.json` into the canonical `bos.app.ts` descriptor
 * (a plain-object default export — no package imports, so the converted file
 * loads even before the child's node_modules exists), with the
 * original preserved under `.bos/sync-backup/`. Field accounting runs before
 * any write: entries the descriptor form cannot express (authored production
 * URLs without an extends target, gateway, unknown slots) abort the conversion
 * loudly with the manual path — the tree is never left half-converted.
 * Pipeline fields on plugins entries rewrite to targeted extends refs (the
 * v1 author-config semantics). Idempotent; no-op without the legacy file.
 */
export async function convertLegacyJsonConfig(
  projectDir: string,
): Promise<LegacyJsonConfigConversion> {
  const jsonPath = join(projectDir, "bos.config.json");
  if (!existsSync(jsonPath)) return { status: "absent" };
  const appPath = join(projectDir, "bos.app.ts");
  if (existsSync(appPath)) return { status: "already-descriptor" };

  const source = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
  const translated = translateForDescriptor(source);
  const descriptor = configInputToDescriptor(translated);
  const descriptorSource = `export default ${JSON.stringify(descriptor, null, 2)};\n`;

  const backupDir = join(projectDir, ".bos", "sync-backup");
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(jsonPath, join(backupDir, "bos.config.json"));

  writeFileSync(appPath, descriptorSource);
  rmSync(jsonPath);

  await loadInProcessDescriptor(descriptorSource, basename(appPath));
  return { status: "converted" };
}
