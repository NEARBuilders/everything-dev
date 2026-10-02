import { describe, expect, it } from "vitest";
import { APP_LOCALE_LABELS, APP_LOCALES, englishAppMessages, getAppMessages } from "./catalogs";

describe("app message catalogs", () => {
  it("provides every app message in each supported locale", () => {
    for (const locale of APP_LOCALES) {
      const messages = getAppMessages(locale);
      for (const id of Object.keys(englishAppMessages)) {
        expect(messages[id], `${locale}:${id}`).toBeTruthy();
      }
    }
  });

  it("loads translated landing headings", () => {
    expect(getAppMessages("es")["landing.title"]).toBe("Tu ciudad, en la red.");
    expect(getAppMessages("fr")["landing.title"]).toBe("Votre ville, sur le réseau.");
    expect(getAppMessages("zh")["landing.title"]).toBe("让你的城市加入网络。");
  });

  it("provides a native label for every language option", () => {
    expect(Object.keys(APP_LOCALE_LABELS)).toEqual(APP_LOCALES);
    expect(APP_LOCALE_LABELS).toEqual({
      en: "English",
      es: "Español",
      fr: "Français",
      zh: "中文",
    });
  });

  it("interpolates translated public-flow values", () => {
    expect(getAppMessages("es")["apply.slug.available"]).toContain("{hostname}");
    expect(getAppMessages("fr")["explore.results.many"]).toContain("{count}");
    expect(getAppMessages("zh")["apply.progress"]).toContain("{step}");
  });
});
