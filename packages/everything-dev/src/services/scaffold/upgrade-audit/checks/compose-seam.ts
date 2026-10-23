import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { Finding } from "../domain";
import { fileExists, readText } from "../fs";

/**
 * Compose-seam guard — replays the host's SSR composition collision locally:
 * our core ui manifest (which claims /login) composed with the deployed
 * auth-ui manifest (which ships _public/login plus a device-login subtree).
 *
 * every-plugin's constructTree handles the collision by design ("core ui
 * wins; shadowed route skipped") but pre-fix releases mark the shadowed
 * children without splicing them out of `pending`, so the loop exits
 * non-empty and throws a false "unresolvable parentage" — the prod boot
 * failure this guard watches for. Run with: pnpm compose-seam [--live]
 */

export const UI_MANIFEST_PATH = "ui/src/manifest.gen.json";
export const AUTH_FIXTURE_PATH = "fixtures/compose-seam/auth-ui.manifest.gen.json";
export const AUTH_MANIFEST_URL =
  "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/auth-ui/manifest.gen.json";
export const AUTH_PLUGIN_KEY = "auth";
export const CORE_UI_KEY = "ui";
export const SHADOW_LOG_MARKER = "core ui wins; shadowed route skipped";

export interface ManifestRoute {
  readonly id: string;
  readonly type: "index" | "layout" | "route";
  readonly path?: string;
  readonly parentId?: string;
  readonly mount?: string;
}

export interface PluginManifestData {
  readonly name: string;
  readonly manifestVersion: number;
  readonly routes: readonly ManifestRoute[];
}

export type ComposeSeam =
  | "ok"
  | "cascade-bug"
  | "path-collision"
  | "compose-failed"
  | "absent-ui-manifest";

export interface ComposeProbe {
  readonly seam: ComposeSeam;
  /** `[Compose]` lines emitted by constructTree during the probe */
  readonly composeLog: readonly string[];
  readonly error?: string;
  readonly mountCounts?: Record<string, number>;
  readonly uiClaimsLogin: boolean;
}

export type ConstructTreeFn = (input: {
  name: string;
  plugins: ReadonlyArray<{ key: string; mfName: string }>;
  resolve: (ref: { key: string; mfName: string }) => Promise<{
    key: string;
    manifest: PluginManifestData;
    routeConfig: { routeConfigLoaders: Record<string, () => Promise<unknown>> };
  }>;
  rootOptions?: unknown;
}) => Promise<{ mountCounts: Record<string, number> }>;

/** Pure — "unresolvable parentage" after a shadow log is the known cascade bug. */
export const classifyComposeError = (
  message: string,
  shadowedARoute: boolean,
): Exclude<ComposeSeam, "ok" | "absent-ui-manifest"> => {
  if (message.includes("path collision:")) return "path-collision";
  if (message.includes("unresolvable parentage") && shadowedARoute) return "cascade-bug";
  return "compose-failed";
};

/** Pure — every manifest route id needs a loader or constructTree refuses. */
export const stubRouteConfigLoaders = (manifest: PluginManifestData) =>
  Object.fromEntries(manifest.routes.map((record) => [record.id, async () => ({})]));

export const uiClaimsLogin = (manifest: PluginManifestData): boolean =>
  manifest.routes.some((record) => record.id === "_public/login" && record.path === "/login");

const captureConsole = async (fn: () => Promise<{ mountCounts: Record<string, number> }>) => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  let result: { mountCounts: Record<string, number> } | undefined;
  let error: unknown;
  try {
    result = await fn();
  } catch (cause) {
    error = cause;
  } finally {
    console.log = original;
  }
  return { lines, result, error };
};

/**
 * Runs the real composer (or an injected stand-in) over the two manifests.
 * The auth manifest's /login tree is the collision shape; classification
 * only — never throws.
 */
export const runComposeProbe = async (
  uiManifest: PluginManifestData,
  authManifest: PluginManifestData,
  constructTree: ConstructTreeFn,
): Promise<ComposeProbe> => {
  const claimsLogin = uiClaimsLogin(uiManifest);
  const manifests = new Map<string, PluginManifestData>([
    [CORE_UI_KEY, uiManifest],
    [AUTH_PLUGIN_KEY, authManifest],
  ]);
  try {
    const { lines, result, error } = await captureConsole(() =>
      constructTree({
        name: "compose-seam-probe",
        plugins: [
          { key: CORE_UI_KEY, mfName: CORE_UI_KEY },
          { key: AUTH_PLUGIN_KEY, mfName: AUTH_PLUGIN_KEY },
        ],
        resolve: async (ref) => {
          const manifest = manifests.get(ref.key);
          if (!manifest) throw new Error(`probe has no manifest for "${ref.key}"`);
          return {
            key: ref.key,
            manifest,
            routeConfig: { routeConfigLoaders: stubRouteConfigLoaders(manifest) },
          };
        },
      }),
    );
    if (error === undefined) {
      return {
        seam: "ok",
        composeLog: lines,
        mountCounts: result?.mountCounts,
        uiClaimsLogin: claimsLogin,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const shadowedARoute = lines.some((line) => line.includes(SHADOW_LOG_MARKER));
    return {
      seam: classifyComposeError(message, shadowedARoute),
      composeLog: lines,
      error: message,
      uiClaimsLogin: claimsLogin,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      seam: "compose-failed",
      composeLog: [],
      error: message,
      uiClaimsLogin: claimsLogin,
    };
  }
};

const loadManifest = (source: string, label: string): Effect.Effect<PluginManifestData, Error> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(source) as PluginManifestData;
      if (!Array.isArray(parsed.routes) || typeof parsed.name !== "string") {
        throw new Error("not a plugin manifest (name/routes missing)");
      }
      return parsed;
    },
    catch: (error) => new Error(`${label}: ${String(error)}`),
  });

export interface ProbeOptions {
  /** fetch the deployed auth-ui manifest instead of the committed fixture */
  readonly live?: boolean;
}

/** Reads both manifests and runs the probe; succeeds even when compose fails. */
export const probeComposeSeam = (
  projectDir: string,
  options?: ProbeOptions,
): Effect.Effect<ComposeProbe, Error> =>
  Effect.gen(function* () {
    const uiExists = yield* fileExists(projectDir, UI_MANIFEST_PATH);
    if (!uiExists) {
      return {
        seam: "absent-ui-manifest",
        composeLog: [],
        uiClaimsLogin: false,
      } satisfies ComposeProbe;
    }

    const uiManifest = yield* loadManifest(
      yield* readText(projectDir, UI_MANIFEST_PATH),
      UI_MANIFEST_PATH,
    );

    let authSource: string;
    if (options?.live) {
      authSource = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(AUTH_MANIFEST_URL);
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return await response.text();
        },
        catch: (error) => new Error(`failed to fetch deployed auth-ui manifest: ${String(error)}`),
      });
    } else {
      authSource = yield* Effect.tryPromise({
        try: () => readFile(new URL(`../${AUTH_FIXTURE_PATH}`, import.meta.url), "utf-8"),
        catch: (error) =>
          new Error(`failed to load the committed auth-ui fixture: ${String(error)}`),
      });
    }
    const authManifest = yield* loadManifest(authSource, "auth-ui manifest");

    const { constructTree } = yield* Effect.tryPromise({
      try: () => import("every-plugin/ui/manifest"),
      catch: (error) => new Error(`failed to load every-plugin's composer: ${String(error)}`),
    });

    return yield* Effect.tryPromise({
      try: () =>
        runComposeProbe(uiManifest, authManifest, constructTree as unknown as ConstructTreeFn),
      catch: (error) => new Error(`compose probe failed: ${String(error)}`),
    });
  });

export const readEveryPluginVersion = (projectDir: string): Effect.Effect<string> =>
  Effect.sync(() => {
    try {
      const source = readFileSync(`${projectDir}/node_modules/every-plugin/package.json`, "utf-8");
      return (JSON.parse(source) as { version?: string }).version ?? "unknown";
    } catch {
      return "unknown";
    }
  });

/** Pure — probe outcome → audit findings. */
export const composeFindings = (probe: ComposeProbe, everyPluginVersion: string): Finding[] => {
  if (probe.seam === "ok") return [];
  if (probe.seam === "absent-ui-manifest") {
    return [
      new Finding({
        check: "compose-seam",
        path: UI_MANIFEST_PATH,
        severity: "warn",
        message:
          "ui/src/manifest.gen.json is absent — run `pnpm types:gen`; the compose probe needs the generated manifest",
      }),
    ];
  }
  const messages: Record<"cascade-bug" | "path-collision" | "compose-failed", string> = {
    "cascade-bug":
      `every-plugin ${everyPluginVersion} still throws a false "unresolvable parentage" for the /login shadow cascade ` +
      "(constructTree marks shadowed children without splicing them out of pending) — prod boot SSR composition fails with this. " +
      "Bump everything-dev/every-plugin to the release with the cascade-splice fix, then redeploy",
    "path-collision":
      'the composer treats the /login shadow as a hard path collision instead of "core ui wins" — shadow handling regressed; ' +
      `check every-plugin ${everyPluginVersion} constructTree against the auth-ui manifest`,
    "compose-failed": `compose probe failed: ${probe.error ?? "unknown error"}`,
  };
  return [
    new Finding({
      check: "compose-seam",
      path: "ui/src/manifest.gen.json + auth-ui manifest",
      severity: "blocker",
      message: messages[probe.seam],
    }),
  ];
};

export const checkComposeSeam = (
  projectDir: string,
  options?: ProbeOptions,
): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const probe = yield* probeComposeSeam(projectDir, options);
    const version = yield* readEveryPluginVersion(projectDir);
    return composeFindings(probe, version);
  });
