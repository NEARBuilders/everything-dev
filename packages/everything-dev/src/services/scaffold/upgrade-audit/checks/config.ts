import { Effect } from "effect";
import { Finding, KNOWN_APP_SLOT_KEYS, KNOWN_CONFIG_KEYS, KNOWN_PLUGIN_KEYS } from "../domain";
import { fileExists, readText } from "../fs";

interface BosConfig {
  readonly extends?: unknown;
  readonly account?: unknown;
  readonly domain?: unknown;
  readonly app?: unknown;
  readonly plugins?: unknown;
  readonly [key: string]: unknown;
}

const parseJson = (source: string): Effect.Effect<BosConfig, Error> =>
  Effect.try({
    try: () => JSON.parse(source) as BosConfig,
    catch: (error) => new Error(`bos.config.json is not valid JSON: ${String(error)}`),
  });

const checkAppSlot = (slotPath: string, slot: unknown): Finding[] => {
  if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const key of Object.keys(slot as Record<string, unknown>)) {
    if (!KNOWN_APP_SLOT_KEYS.includes(key as (typeof KNOWN_APP_SLOT_KEYS)[number])) {
      findings.push(
        new Finding({
          check: "config",
          path: slotPath,
          severity: "warn",
          message: `unknown app slot key "${key}" — not mappable to the v2 surface`,
        }),
      );
    }
  }
  return findings;
};

const checkPlugins = (plugins: unknown): Finding[] => {
  if (plugins === null || typeof plugins !== "object" || Array.isArray(plugins)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const [name, entry] of Object.entries(plugins as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    for (const key of Object.keys(entry as Record<string, unknown>)) {
      if (!KNOWN_PLUGIN_KEYS.includes(key as (typeof KNOWN_PLUGIN_KEYS)[number])) {
        findings.push(
          new Finding({
            check: "config",
            path: `plugins.${name}`,
            severity: "warn",
            message: `unknown plugin key "${key}" — not mappable to the v2 surface`,
          }),
        );
      }
    }
  }
  return findings;
};

export const checkConfig = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, "bos.config.json");
    if (!exists) {
      return [
        new Finding({
          check: "config",
          path: "bos.config.json",
          severity: "blocker",
          message: "bos.config.json not found",
        }),
      ];
    }

    const config = yield* readText(projectDir, "bos.config.json").pipe(Effect.flatMap(parseJson));
    const findings: Finding[] = [];

    for (const key of Object.keys(config)) {
      if (!KNOWN_CONFIG_KEYS.includes(key as (typeof KNOWN_CONFIG_KEYS)[number])) {
        findings.push(
          new Finding({
            check: "config",
            path: "bos.config.json",
            severity: "warn",
            message: `unknown top-level key "${key}" — not mappable to the v2 surface`,
          }),
        );
      }
    }

    if (typeof config.extends !== "string" || !config.extends.startsWith("bos://")) {
      findings.push(
        new Finding({
          check: "config",
          path: "bos.config.json",
          severity: "blocker",
          message: '"extends" must be a bos:// ref — child apps upgrade through the extends chain',
        }),
      );
    }
    if (typeof config.account !== "string" || config.account.length === 0) {
      findings.push(
        new Finding({
          check: "config",
          path: "bos.config.json",
          severity: "blocker",
          message: '"account" is required',
        }),
      );
    }
    if (typeof config.domain !== "string" || config.domain.length === 0) {
      findings.push(
        new Finding({
          check: "config",
          path: "bos.config.json",
          severity: "blocker",
          message: '"domain" is required',
        }),
      );
    }

    const app = config.app;
    if (app !== null && typeof app === "object" && !Array.isArray(app)) {
      for (const [slot, value] of Object.entries(app as Record<string, unknown>)) {
        findings.push(...checkAppSlot(`app.${slot}`, value));
      }
    }
    findings.push(...checkPlugins(config.plugins));

    return findings;
  });
