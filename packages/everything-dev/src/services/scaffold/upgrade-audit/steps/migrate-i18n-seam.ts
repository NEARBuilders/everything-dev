import { Effect } from "effect";
import {
  APP_PATH,
  CATALOGS_PATH,
  parseAppLocale,
  ROOT_PATH,
  RUNTIME_IMPORT,
  RUNTIME_PATH,
} from "../checks/i18n-seam";
import { fileExists, readText, writeText } from "../fs";
import type { StepResult } from "./author-config";

/**
 * Wires the shared i18n runtime into a v2 child app's core UI.
 *
 * The host's auth plugin consumes shared `@lingui/*` with `import: false` —
 * only the app's own UI (the core-ui provider in the child's federation
 * graph) can provide them. A core UI that never imports
 * `everything-dev/ui/i18n` at runtime ships no `@lingui/*` share-scope
 * entries, and boot fails at SSR composition with RUNTIME-012 ("The getter
 * for the shared module is not a function … shareKey @lingui/core").
 *
 * The seam is the upstream canonical one: app-owned `ui/src/i18n/catalogs.ts`
 * (locales + message catalogs) and `ui/src/i18n/runtime.tsx`
 * (`createLocaleRuntime` → `AppI18nProvider`), mounted in the root route.
 * Locale config derives from the app's `appLocale` bootstrap export (the
 * generated stubs read it) so the two stay consistent.
 *
 * Maintenance step for post-upgrade trees:
 * `pnpm i18n-seam [--dry-run]`
 */

const DEFAULT_LOCALE_CONFIG = {
  locales: ["en"],
  defaultLocale: "en",
  cookieName: "app_locale",
};

const renderCatalogs = (config: {
  locales: readonly string[];
  defaultLocale: string;
  cookieName: string;
}): string =>
  [
    'import type { Messages } from "@lingui/core";',
    "",
    "// No copy in this app uses <Trans> message ids yet. The catalog exists so the",
    "// shared i18n runtime ships in this bundle's Module Federation share scope —",
    "// the host's auth plugin resolves @lingui/* through it (RUNTIME-012 at SSR",
    "// composition otherwise). Add message ids here as surfaces adopt <Trans>.",
    `export const APP_LOCALES = [${config.locales.map((l) => `"${l}"`).join(", ")}] as const;`,
    "export type AppLocale = (typeof APP_LOCALES)[number];",
    `export const DEFAULT_APP_LOCALE: AppLocale = "${config.defaultLocale}";`,
    `export const APP_LOCALE_COOKIE = "${config.cookieName}";`,
    "",
    "const englishMessages = {} satisfies Record<string, string>;",
    "",
    "const translatedMessages: Record<AppLocale, Partial<Record<string, string>>> = {",
    "  en: {},",
    "};",
    "",
    "export function getAppMessages(locale: AppLocale): Messages {",
    "  return { ...englishMessages, ...translatedMessages[locale] };",
    "}",
    "",
  ].join("\n");

const renderRuntime = (): string =>
  [
    'import { createLocaleRuntime } from "everything-dev/ui/i18n";',
    'import type { ReactNode } from "react";',
    'import { APP_LOCALES, APP_LOCALE_COOKIE, DEFAULT_APP_LOCALE, getAppMessages } from "./catalogs";',
    "",
    "const appRuntime = createLocaleRuntime({",
    "  locales: APP_LOCALES,",
    "  defaultLocale: DEFAULT_APP_LOCALE,",
    "  cookieName: APP_LOCALE_COOKIE,",
    "});",
    "",
    "export function AppI18nProvider({",
    "  children,",
    "  preferredLocale,",
    "}: {",
    "  children: ReactNode;",
    "  preferredLocale?: string | null;",
    "}) {",
    "  return (",
    "    <appRuntime.LocaleProvider messages={getAppMessages} preferredLocale={preferredLocale}>",
    "      {children}",
    "    </appRuntime.LocaleProvider>",
    "  );",
    "}",
    "",
    "export const useAppLocale = appRuntime.useLocale;",
    "",
  ].join("\n");

/**
 * Wraps the single child of the root's `<div id="root">` shell with the
 * provider. Child roots carry app-owned chrome, so anything but the known
 * one-child-shell shape is left for manual wiring rather than guessed at.
 */
const mountProvider = (source: string): { source: string; mounted: boolean } => {
  const lines = source.split("\n");
  const openIdx = lines.findIndex((l) => l.trim() === '<div id="root">');
  if (openIdx === -1) return { source, mounted: false };

  const openIndent = lines[openIdx].search(/\S/);
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "</div>") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1 || closeIdx === openIdx + 1) return { source, mounted: false };

  const childLines = lines.slice(openIdx + 1, closeIdx);
  const childIndent = childLines[0]?.search(/\S/) ?? openIndent + 2;
  if (childIndent <= openIndent) return { source, mounted: false };

  const indented = childLines.map((l) => (l.trim() ? `  ${l}` : l));
  const providerOpen = `${" ".repeat(childIndent)}<AppI18nProvider>`;
  const providerClose = `${" ".repeat(childIndent)}</AppI18nProvider>`;

  const ordered = [
    ...lines.slice(0, openIdx + 1),
    providerOpen,
    ...indented,
    providerClose,
    ...lines.slice(closeIdx),
  ];
  return { source: ordered.join("\n"), mounted: true };
};

export const migrateI18nSeam = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const notes: string[] = [];

    const appExists = yield* fileExists(projectDir, APP_PATH);
    const config = appExists
      ? (parseAppLocale(yield* readText(projectDir, APP_PATH)) ?? DEFAULT_LOCALE_CONFIG)
      : DEFAULT_LOCALE_CONFIG;
    if (!appExists) {
      notes.push(
        `ui/src/app.ts absent — defaulting the i18n config to ${config.defaultLocale}/${config.cookieName}`,
      );
    }

    const runtimeExists = yield* fileExists(projectDir, RUNTIME_PATH);
    if (!runtimeExists) {
      for (const [path, render] of [
        [CATALOGS_PATH, (): string => renderCatalogs(config)],
        [RUNTIME_PATH, renderRuntime],
      ] as const) {
        const exists = yield* fileExists(projectDir, path);
        if (exists) {
          notes.push(`${path} exists — left untouched`);
          continue;
        }
        if (!dryRun) yield* writeText(projectDir, path, render());
        writes.push(path);
      }
    } else {
      notes.push("ui/src/i18n/runtime.tsx exists — left untouched");
    }

    const rootExists = yield* fileExists(projectDir, ROOT_PATH);
    if (!rootExists) {
      notes.push("ui/src/routes/__root.tsx absent — provider not mounted, inspect manually");
      return { writes, deletes: [], notes };
    }

    const rootSource = yield* readText(projectDir, ROOT_PATH);
    if (rootSource.includes(RUNTIME_IMPORT)) {
      notes.push("root route already mounts AppI18nProvider");
      return { writes, deletes: [], notes };
    }

    const { source: mounted, mounted: ok } = mountProvider(rootSource);
    if (!ok) {
      notes.push(
        'root route shell shape not recognized (expected a single child under <div id="root">) — mount AppI18nProvider manually',
      );
      return { writes, deletes: [], notes };
    }

    const withImport = `${`import { AppI18nProvider } from "${RUNTIME_IMPORT}";\n`}${mounted}`;
    if (!dryRun) yield* writeText(projectDir, ROOT_PATH, withImport);
    writes.push(ROOT_PATH);
    notes.push(
      "AppI18nProvider mounted in the root route — the UI bundle now provides @lingui/* through the share scope",
      "optional follow-up: thread the session user's locale as preferredLocale (the canonical upstream root does)",
    );

    return { writes, deletes: [], notes };
  });
