import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createLocaleRuntime,
  matchLocale,
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
    cookieName: "app_locale",
    ...overrides,
  });
}

describe("shared locale resolution", () => {
  it("uses account preference before cookie and browser language", () => {
    expect(
      resolve({
        preferredLocale: "zh-CN",
        cookie: "app_locale=fr",
        browserLocales: ["es-MX"],
      }),
    ).toBe("zh");
  });

  it("uses a persisted locale before browser language", () => {
    expect(resolve({ cookie: "theme=dark; app_locale=fr", browserLocales: ["es-MX"] })).toBe("fr");
  });

  it("matches the first supported browser language", () => {
    expect(resolve({ browserLocales: ["de-DE", "es-MX", "fr-FR"] })).toBe("es");
  });

  it("falls back to English for unsupported or malformed preferences", () => {
    expect(resolve({ cookie: "app_locale=invalid", browserLocales: ["de-DE"] })).toBe("en");
    expect(resolve({ cookie: "app_locale=%E0%A4%A", browserLocales: [] })).toBe("en");
  });
});

describe("shared locale persistence", () => {
  it("matches regional locale tags and ignores unsupported values", () => {
    expect(matchLocale("fr-CA", locales)).toBe("fr");
    expect(matchLocale("de-DE", locales)).toBeUndefined();
  });

  it("reads and serializes the locale cookie", () => {
    expect(readLocaleCookie("theme=dark; app_locale=zh", "app_locale")).toBe("zh");
    expect(serializeLocaleCookie("app_locale", "es", false)).toBe(
      "app_locale=es; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(serializeLocaleCookie("app_locale", "es", true)).toContain("; Secure");
  });
});

describe("shared locale provider", () => {
  it("renders when the server runtime exposes navigator without language preferences", () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });

    try {
      const runtime = createLocaleRuntime({
        locales,
        defaultLocale: "en",
        cookieName: "app_locale",
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
