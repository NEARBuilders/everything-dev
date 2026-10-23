import { Effect } from "effect";
import { Finding } from "../domain";
import { fileExists, readText } from "../fs";

export const APP_PATH = "ui/src/app.ts";
export const CATALOGS_PATH = "ui/src/i18n/catalogs.ts";
export const RUNTIME_PATH = "ui/src/i18n/runtime.tsx";
export const ROOT_PATH = "ui/src/routes/__root.tsx";
export const RUNTIME_IMPORT = "@/i18n/runtime";

export interface AppLocaleConfig {
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly cookieName: string;
}

export type I18nSeam = "wired" | "unmounted" | "missing" | "absent-root";

export interface I18nSeamState {
  readonly appLocale: AppLocaleConfig | null;
  readonly seam: I18nSeam;
  readonly catalogsDrift: readonly string[];
}

export const parseAppLocale = (source: string): AppLocaleConfig | null => {
  const match = source.match(/export\s+const\s+appLocale[^=]*=\s*\{([\s\S]*?)\}/);
  if (!match) return null;
  const body = match[1];
  const locales = body.match(/locales:\s*\[([^\]]*)\]/)?.[1];
  const defaultLocale = body.match(/defaultLocale:\s*"([^"]+)"/)?.[1];
  const cookieName = body.match(/cookieName:\s*"([^"]+)"/)?.[1];
  if (!locales || !defaultLocale || !cookieName) return null;
  return {
    locales: locales
      .split(",")
      .map((l) => l.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean),
    defaultLocale,
    cookieName,
  };
};

const parseCatalogs = (source: string): AppLocaleConfig | null => {
  const locales = source.match(/APP_LOCALES\s*=\s*\[([^\]]*)\]/)?.[1];
  const defaultLocale = source.match(/DEFAULT_APP_LOCALE[^=]*=\s*"([^"]+)"/)?.[1];
  const cookieName = source.match(/APP_LOCALE_COOKIE[^=]*=\s*"([^"]+)"/)?.[1];
  if (!locales || !defaultLocale || !cookieName) return null;
  return {
    locales: locales
      .split(",")
      .map((l) => l.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean),
    defaultLocale,
    cookieName,
  };
};

const localeDrift = (appLocale: AppLocaleConfig, catalogs: AppLocaleConfig): string[] => {
  const drift: string[] = [];
  if (appLocale.defaultLocale !== catalogs.defaultLocale)
    drift.push(
      `defaultLocale: app.ts "${appLocale.defaultLocale}" vs catalogs "${catalogs.defaultLocale}"`,
    );
  if (appLocale.cookieName !== catalogs.cookieName)
    drift.push(`cookieName: app.ts "${appLocale.cookieName}" vs catalogs "${catalogs.cookieName}"`);
  const a = appLocale.locales.join(",");
  const b = catalogs.locales.join(",");
  if (a !== b) drift.push(`locales: app.ts [${a}] vs catalogs [${b}]`);
  return drift;
};

export const readI18nSeam = (projectDir: string): Effect.Effect<I18nSeamState, Error> =>
  Effect.gen(function* () {
    const appExists = yield* fileExists(projectDir, APP_PATH);
    const appLocale = appExists ? parseAppLocale(yield* readText(projectDir, APP_PATH)) : null;

    const runtimeExists = yield* fileExists(projectDir, RUNTIME_PATH);
    const rootExists = yield* fileExists(projectDir, ROOT_PATH);

    let seam: I18nSeam;
    if (!runtimeExists) seam = "missing";
    else if (!rootExists) seam = "absent-root";
    else {
      const rootSource = yield* readText(projectDir, ROOT_PATH);
      seam = rootSource.includes(RUNTIME_IMPORT) ? "wired" : "unmounted";
    }

    let catalogsDrift: string[] = [];
    if (appLocale && (yield* fileExists(projectDir, CATALOGS_PATH))) {
      const catalogs = parseCatalogs(yield* readText(projectDir, CATALOGS_PATH));
      if (catalogs) catalogsDrift = localeDrift(appLocale, catalogs);
    }

    return { appLocale, seam, catalogsDrift };
  });

export const checkI18nSeam = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const { appLocale, seam, catalogsDrift } = yield* readI18nSeam(projectDir);
    const findings: Finding[] = [];

    // The host's auth plugin consumes shared @lingui/* (import: false) — only a
    // wired core-ui provides it, so the seam matters even without appLocale.
    if (seam === "missing") {
      findings.push(
        new Finding({
          check: "i18n-seam",
          path: RUNTIME_PATH,
          severity: "warn",
          message:
            "the shared i18n runtime is not wired — the UI bundle shares no @lingui/*, so the host's auth plugin fails SSR composition with RUNTIME-012 (shareKey @lingui/core). Run `pnpm i18n-seam` to scaffold ui/src/i18n and mount AppI18nProvider",
        }),
      );
    } else if (seam === "unmounted") {
      findings.push(
        new Finding({
          check: "i18n-seam",
          path: RUNTIME_PATH,
          severity: "warn",
          message:
            "ui/src/i18n/runtime.tsx exists but no route imports it — the provider never enters the bundle, so @lingui/* stays out of the share scope (RUNTIME-012 at SSR composition). Mount AppI18nProvider in the root route",
        }),
      );
    } else if (seam === "absent-root") {
      findings.push(
        new Finding({
          check: "i18n-seam",
          path: ROOT_PATH,
          severity: "warn",
          message:
            "ui/src/i18n/runtime.tsx exists but ui/src/routes/__root.tsx is absent — the provider cannot be mounted; inspect the route tree",
        }),
      );
    }

    if (appLocale && catalogsDrift.length > 0) {
      findings.push(
        new Finding({
          check: "i18n-seam",
          path: CATALOGS_PATH,
          severity: "warn",
          message: `i18n catalogs drift from app.ts's appLocale: ${catalogsDrift.join("; ")}`,
        }),
      );
    }

    return findings;
  });
