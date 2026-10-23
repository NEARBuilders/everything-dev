import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkI18nSeam } from "../../../src/services/scaffold/upgrade-audit/checks/i18n-seam";
import { migrateI18nSeam } from "../../../src/services/scaffold/upgrade-audit/steps/migrate-i18n-seam";

// Pre-wiring state: the app declares the appLocale bootstrap override and has
// a root with the standard single-child shell, but no ui/src/i18n seam — the
// exact precondition of the RUNTIME-012 SSR-composition failure.
let projectDir: string;

const APP_TS = [
  'import type { LocaleOptions } from "everything-dev/ui/i18n";',
  "",
  "export const appLocale: LocaleOptions<string> = {",
  '  locales: ["en"],',
  '  defaultLocale: "en",',
  '  cookieName: "app_locale",',
  "};",
  "",
].join("\n");

const ROOT_TSX = [
  "export function RootComponent() {",
  "  return (",
  "    <html>",
  "      <body>",
  "        <ThemeProvider>",
  '          <div id="root">',
  "            <SessionShell />",
  "          </div>",
  "        </ThemeProvider>",
  "      </body>",
  "    </html>",
  "  );",
  "",
  "function SessionShell() {",
  "  return <Outlet />;",
  "}",
  "",
].join("\n");

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-i18n-seam-"));
  await mkdir(join(projectDir, "ui/src/routes"), { recursive: true });
  await writeFile(join(projectDir, "ui/src/app.ts"), APP_TS);
  await writeFile(join(projectDir, "ui/src/routes/__root.tsx"), ROOT_TSX);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const run = async (dryRun: boolean) => Effect.runPromise(migrateI18nSeam(projectDir, dryRun));

const readUi = (name: string) => readFile(join(projectDir, "ui/src", name), "utf-8");

describe("checkI18nSeam", () => {
  it("warns with the RUNTIME-012 consequence when the seam is missing", async () => {
    const findings = await Effect.runPromise(checkI18nSeam(projectDir));
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("i18n-seam");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].message).toMatch(/RUNTIME-012/);
    expect(findings[0].message).toMatch(/pnpm i18n-seam/);
  });

  it("stays quiet once wired", async () => {
    await run(false);
    const findings = await Effect.runPromise(checkI18nSeam(projectDir));
    expect(findings).toEqual([]);
  });

  it("flags catalog drift from the appLocale bootstrap export", async () => {
    await run(false);
    await writeFile(
      join(projectDir, "ui/src/i18n/catalogs.ts"),
      [
        'import type { Messages } from "@lingui/core";',
        "",
        'export const APP_LOCALES = ["en", "fr"] as const;',
        "export type AppLocale = (typeof APP_LOCALES)[number];",
        'export const DEFAULT_APP_LOCALE: AppLocale = "en";',
        'export const APP_LOCALE_COOKIE = "app_locale_v2";',
        "",
        "export function getAppMessages(locale: AppLocale): Messages {",
        "  return {};",
        "}",
        "",
      ].join("\n"),
    );
    const findings = await Effect.runPromise(checkI18nSeam(projectDir));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toContain("catalogs.ts");
    expect(findings[0].message).toMatch(/drift/);
    expect(findings[0].message).toMatch(/app_locale_v2/);
  });
});

describe("migrateI18nSeam", () => {
  it("scaffolds the seam and mounts the provider in the root", async () => {
    const result = await run(false);
    expect(result.writes).toContain("ui/src/i18n/catalogs.ts");
    expect(result.writes).toContain("ui/src/i18n/runtime.tsx");
    expect(result.writes).toContain("ui/src/routes/__root.tsx");

    const catalogs = await readUi("i18n/catalogs.ts");
    expect(catalogs).toContain('export const APP_LOCALES = ["en"] as const;');
    expect(catalogs).toContain('export const APP_LOCALE_COOKIE = "app_locale";');

    const runtime = await readUi("i18n/runtime.tsx");
    expect(runtime).toContain('import { createLocaleRuntime } from "everything-dev/ui/i18n";');
    expect(runtime).toContain("appRuntime.LocaleProvider");

    const root = await readUi("routes/__root.tsx");
    expect(root).toContain('import { AppI18nProvider } from "@/i18n/runtime";');
    expect(root).toMatch(
      /<div id="root">\n\s*<AppI18nProvider>\n\s*<SessionShell \/>\n\s*<\/AppI18nProvider>\n\s*<\/div>/,
    );
  });

  it("derives the locale config from the appLocale bootstrap export", async () => {
    await writeFile(
      join(projectDir, "ui/src/app.ts"),
      APP_TS.replace('["en"]', '["en", "fr"]').replace('"app_locale"', '"ui_locale"'),
    );
    await run(false);
    const catalogs = await readUi("i18n/catalogs.ts");
    expect(catalogs).toContain('export const APP_LOCALES = ["en", "fr"] as const;');
    expect(catalogs).toContain('export const APP_LOCALE_COOKIE = "ui_locale";');
  });

  it("does not write on dry-run", async () => {
    const before = await readUi("routes/__root.tsx");
    const result = await run(true);
    expect(result.writes).toContain("ui/src/i18n/catalogs.ts");
    let throws = false;
    try {
      await readUi("i18n/catalogs.ts");
    } catch {
      throws = true;
    }
    expect(throws).toBe(true);
    expect(await readUi("routes/__root.tsx")).toBe(before);
  });

  it("is idempotent", async () => {
    await run(false);
    const result = await run(false);
    expect(result.writes).toEqual([]);
    expect(result.notes.join("\n")).toMatch(/already mounts AppI18nProvider/);
  });

  it("leaves unrecognized root shells alone with a manual note", async () => {
    await writeFile(
      join(projectDir, "ui/src/routes/__root.tsx"),
      "export const chrome = <SessionShell />;\n",
    );
    const result = await run(false);
    expect(result.writes).not.toContain("ui/src/routes/__root.tsx");
    expect(result.notes.join("\n")).toMatch(/mount AppI18nProvider manually/);
  });
});
