import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createLocaleRuntime,
  matchLocale,
  readAcceptLanguage,
  readLocaleCookie,
  resolveLocale,
  serializeLocaleCookie,
} from "../../src/ui/i18n";

const locales = ["en", "es", "fr", "zh"] as const;

function resolve(overrides: Partial<Parameters<typeof resolveLocale>[0]> = {}) {
  return resolveLocale({
    preferredLocale: undefined,
    cookie: "",
    browserLocales: [],
    locales,
    defaultLocale: "en",
    cookieName: "citynode_locale",
    ...overrides,
  });
}

describe("shared locale resolution", () => {
  it("honors quality preferences and excludes rejected header languages", () => {
    expect(readAcceptLanguage("de;q=0, fr-CA;q=0.7, es;q=0.9, en;q=invalid")).toEqual([
      "es",
      "fr-CA",
    ]);
    expect(resolve({ browserLocales: readAcceptLanguage("fr-CA, es;q=0.8") })).toBe("fr");
  });
  it("uses account preference before cookie and browser language", () => {
    expect(
      resolve({
        preferredLocale: "zh-CN",
        cookie: "citynode_locale=fr",
        browserLocales: ["es-MX"],
      }),
    ).toBe("zh");
  });

  it("uses a persisted locale before browser language", () => {
    expect(resolve({ cookie: "theme=dark; citynode_locale=fr", browserLocales: ["es-MX"] })).toBe(
      "fr",
    );
  });

  it("matches the first supported browser language", () => {
    expect(resolve({ browserLocales: ["de-DE", "es-MX", "fr-FR"] })).toBe("es");
  });

  it("falls back to English for unsupported or malformed preferences", () => {
    expect(resolve({ cookie: "citynode_locale=invalid", browserLocales: ["de-DE"] })).toBe("en");
    expect(resolve({ cookie: "citynode_locale=%E0%A4%A", browserLocales: [] })).toBe("en");
  });
});

describe("shared locale persistence", () => {
  it("matches regional locale tags and ignores unsupported values", () => {
    expect(matchLocale("fr-CA", locales)).toBe("fr");
    expect(matchLocale("de-DE", locales)).toBeUndefined();
  });

  it("reads and serializes the locale cookie", () => {
    expect(readLocaleCookie("theme=dark; citynode_locale=zh", "citynode_locale")).toBe("zh");
    expect(serializeLocaleCookie("citynode_locale", "es", false)).toBe(
      "citynode_locale=es; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(serializeLocaleCookie("citynode_locale", "es", true)).toContain("; Secure");
  });
});

describe("shared locale provider", () => {
  it("renders the request locale and account preference without leaking between requests", () => {
    const runtime = createLocaleRuntime({
      locales,
      defaultLocale: "en",
      cookieName: "server_locale",
    });
    function Greeting() {
      const t = runtime.useTranslation<"greeting">();
      return createElement("span", null, t("greeting"));
    }
    const messages = (locale: string) => ({
      greeting: locale === "fr" ? "Bonjour" : locale === "es" ? "Hola" : "Hello",
    });
    const render = (initialLocale: string, preferredLocale?: string) =>
      renderToString(
        createElement(
          runtime.LocaleProvider,
          { messages, initialLocale, preferredLocale },
          createElement(Greeting),
        ),
      );
    expect(render("fr")).toContain("Bonjour");
    expect(render("fr", "es")).toContain("Hola");
    expect(render("en")).toContain("Hello");
  });

  it("shares the server locale across separately configured bundle providers", () => {
    const main = createLocaleRuntime({ locales, defaultLocale: "en", cookieName: "bundle_locale" });
    const auth = createLocaleRuntime({ locales, defaultLocale: "en", cookieName: "bundle_locale" });
    function AuthGreeting() {
      const t = auth.useTranslation<"greeting">();
      return createElement("span", null, t("greeting"));
    }
    const html = renderToString(
      createElement(
        main.LocaleProvider,
        { initialLocale: "fr", messages: () => ({}) },
        createElement(
          auth.LocaleProvider,
          { messages: (locale) => ({ greeting: locale === "fr" ? "Bonjour" : "Hello" }) },
          createElement(AuthGreeting),
        ),
      ),
    );
    expect(html).toContain("Bonjour");
  });
  it("renders when the server runtime exposes navigator without language preferences", () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });

    try {
      const runtime = createLocaleRuntime({
        locales,
        defaultLocale: "en",
        cookieName: "citynode_locale",
      });
      const html = renderToString(
        createElement(
          runtime.LocaleProvider,
          { messages: () => ({ greeting: "Hello" }) },
          createElement("span", null, "Ready"),
        ),
      );

      expect(html).toContain("Ready");
    } finally {
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "navigator");
      }
    }
  });
});
