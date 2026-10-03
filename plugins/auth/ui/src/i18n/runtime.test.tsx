import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  englishLoginMessages,
  getLoginMessages,
  LOGIN_LOCALE_COOKIE,
  type LoginMessageId,
  withEnglishLoginFallback,
} from "./catalogs";
import { LoginLanguageSelector } from "./language-selector";
import {
  createLoginI18n,
  LoginI18nProvider,
  readLoginLocaleCookie,
  resolveLoginLocale,
  useLoginTranslation,
} from "./runtime";

function TranslationProbe() {
  const t = useLoginTranslation();
  return (
    <>
      <h1>{t("auth.login.title")}</h1>
      <p>{t("auth.login.near.continueAs", { account: "maaz.near" })}</p>
      <LoginLanguageSelector />
    </>
  );
}

afterEach(() => {
  cleanup();
  Reflect.set(document, "cookie", `${LOGIN_LOCALE_COOKIE}=; Path=/; Max-Age=0`);
  document.documentElement.lang = "en";
});

describe("login locale resolution", () => {
  it("prefers a saved locale over browser preferences", () => {
    expect(resolveLoginLocale(`${LOGIN_LOCALE_COOKIE}=es`, ["en-US"])).toBe("es");
  });

  it("matches supported regional browser locales", () => {
    expect(resolveLoginLocale("", ["es-MX", "en-US"])).toBe("es");
    expect(resolveLoginLocale("", ["fr-CA"])).toBe("fr");
    expect(resolveLoginLocale("", ["zh-CN"])).toBe("zh");
  });

  it("falls back to English for unsupported preferences", () => {
    expect(resolveLoginLocale(`${LOGIN_LOCALE_COOKIE}=invalid`, ["de-DE"])).toBe("en");
  });

  it("ignores unrelated cookies", () => {
    expect(readLoginLocaleCookie("theme=dark; session=abc")).toBeUndefined();
  });

  it("falls back safely when the saved locale cookie is malformed", () => {
    expect(resolveLoginLocale(`${LOGIN_LOCALE_COOKIE}=%E0%A4%A`, ["en-US"])).toBe("en");
  });
});

describe("login message catalogs", () => {
  it("compiles ICU messages before loading them into Lingui", () => {
    expect(getLoginMessages("en")["auth.login.near.continueAs"]).toEqual([
      "Continue as ",
      ["account"],
    ]);
  });

  it("interpolates translated values", () => {
    const i18n = createLoginI18n("es");
    expect(i18n._("auth.login.near.continueAs", { account: "maaz.near" })).toBe(
      "Continuar como maaz.near",
    );
  });

  it("fills missing translations from English", () => {
    const messages = withEnglishLoginFallback({});
    for (const id of Object.keys(englishLoginMessages) as LoginMessageId[]) {
      expect(messages[id]).toBe(englishLoginMessages[id]);
    }
  });
});

describe("login language selector", () => {
  it("updates the page language and persists the selection", () => {
    const previousLanguage = document.documentElement.lang;
    const view = render(
      <LoginI18nProvider initialLocale="en">
        <TranslationProbe />
      </LoginI18nProvider>,
    );

    expect(screen.getByRole("heading").textContent).toBe("Sign in to CityNode");
    expect(document.documentElement.lang).toBe("en");

    fireEvent.change(screen.getByTestId("login.language-select"), {
      target: { value: "es" },
    });

    expect(screen.getByRole("heading").textContent).toBe("Inicia sesión en CityNode");
    expect(screen.getByText("Continuar como maaz.near")).toBeTruthy();
    expect(document.cookie).toContain(`${LOGIN_LOCALE_COOKIE}=es`);
    expect(document.documentElement.lang).toBe("es");

    view.unmount();
    expect(document.documentElement.lang).toBe(previousLanguage);
  });

  it("restores a persisted locale on a new mount", () => {
    Reflect.set(document, "cookie", `${LOGIN_LOCALE_COOKIE}=es; Path=/`);
    render(
      <LoginI18nProvider>
        <TranslationProbe />
      </LoginI18nProvider>,
    );

    expect(screen.getByRole("heading").textContent).toBe("Inicia sesión en CityNode");
  });

  it("switches to French and Chinese catalogs", () => {
    render(
      <LoginI18nProvider initialLocale="en">
        <TranslationProbe />
      </LoginI18nProvider>,
    );

    fireEvent.change(screen.getByTestId("login.language-select"), {
      target: { value: "fr" },
    });
    expect(screen.getByRole("heading").textContent).toBe("Se connecter à CityNode");

    fireEvent.change(screen.getByTestId("login.language-select"), {
      target: { value: "zh" },
    });
    expect(screen.getByRole("heading").textContent).toBe("登录 CityNode");
  });
});
