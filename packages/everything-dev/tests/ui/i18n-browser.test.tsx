// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocaleRuntime, readLocaleCookie } from "../../src/ui/i18n";

const locales = ["en", "es", "fr", "zh"] as const;
let container: HTMLDivElement;
let root: Root;
let sequence = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("language persistence across browser bundles", () => {
  it("shares account selection with the auth bundle, cookie, and document language", async () => {
    const cookieName = `bundle_language_${sequence++}`;
    const main = createLocaleRuntime({ locales, defaultLocale: "en", cookieName });
    const auth = createLocaleRuntime({ locales, defaultLocale: "en", cookieName });
    const save = vi.fn(async () => undefined);
    let select: ReturnType<typeof auth.useLocale>["selectLocale"];
    function AuthSettings() {
      const language = auth.useLocale();
      select = language.selectLocale;
      return <output>{language.locale}</output>;
    }
    await act(async () =>
      root.render(
        <main.LocaleProvider
          messages={() => ({})}
          initialLocale="es"
          preferredLocale="fr"
          onLocaleChange={save}
        >
          <auth.LocaleProvider messages={() => ({})}>
            <AuthSettings />
          </auth.LocaleProvider>
        </main.LocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("fr");
    expect(readLocaleCookie(document.cookie, cookieName)).toBe("fr");
    await act(async () => select("zh"));
    expect(save).toHaveBeenCalledExactlyOnceWith("zh");
    expect(container.textContent).toBe("zh");
    expect(main.getLocale()).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
    expect(readLocaleCookie(document.cookie, cookieName)).toBe("zh");
  });

  it("keeps the previous language and cookie when saving the account preference fails", async () => {
    const cookieName = `failed_language_${sequence++}`;
    const runtime = createLocaleRuntime({ locales, defaultLocale: "en", cookieName });
    document.cookie = `${cookieName}=es; Path=/`;
    let select: ReturnType<typeof runtime.useLocale>["selectLocale"];
    function Settings() {
      const language = runtime.useLocale();
      select = language.selectLocale;
      return <output>{language.locale}</output>;
    }
    await act(async () =>
      root.render(
        <runtime.LocaleProvider
          messages={() => ({})}
          onLocaleChange={async () => {
            throw new Error("save failed");
          }}
        >
          <Settings />
        </runtime.LocaleProvider>,
      ),
    );
    await act(async () => expect(select("fr")).rejects.toThrow("save failed"));
    expect(container.textContent).toBe("es");
    expect(readLocaleCookie(document.cookie, cookieName)).toBe("es");
  });

  it("keeps the last account language after signing out and remounting", async () => {
    const cookieName = `signed_out_language_${sequence++}`;
    const runtime = createLocaleRuntime({ locales, defaultLocale: "en", cookieName });
    document.cookie = `${cookieName}=es; Path=/`;
    function Settings() {
      return <output>{runtime.useLocale().locale}</output>;
    }
    await act(async () =>
      root.render(
        <runtime.LocaleProvider messages={() => ({})} preferredLocale="fr">
          <Settings />
        </runtime.LocaleProvider>,
      ),
    );
    await act(async () =>
      root.render(
        <runtime.LocaleProvider messages={() => ({})}>
          <Settings />
        </runtime.LocaleProvider>,
      ),
    );
    expect(container.textContent).toBe("fr");
    expect(readLocaleCookie(document.cookie, cookieName)).toBe("fr");
    const reloaded = createLocaleRuntime({ locales, defaultLocale: "en", cookieName });
    expect(reloaded.detectLocale()).toBe("fr");
  });
});
