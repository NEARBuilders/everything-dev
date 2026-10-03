import { setupI18n } from "@lingui/core";
import {
  createLocaleRuntime,
  readLocaleCookie,
  resolveLocale,
  serializeLocaleCookie,
} from "everything-dev/ui/i18n";
import type { ReactNode } from "react";
import {
  DEFAULT_LOGIN_LOCALE,
  getLoginMessages,
  LOGIN_LOCALE_COOKIE,
  LOGIN_LOCALES,
  type LoginLocale,
  type LoginMessageId,
  type LoginTranslator,
} from "./catalogs";

const loginRuntime = createLocaleRuntime({
  locales: LOGIN_LOCALES,
  defaultLocale: DEFAULT_LOGIN_LOCALE,
  cookieName: LOGIN_LOCALE_COOKIE,
});

export function isLoginLocale(value: string): value is LoginLocale {
  return (LOGIN_LOCALES as readonly string[]).includes(value);
}

export function readLoginLocaleCookie(cookie: string): LoginLocale | undefined {
  const value = readLocaleCookie(cookie, LOGIN_LOCALE_COOKIE);
  return value && isLoginLocale(value) ? value : undefined;
}

export function resolveLoginLocale(cookie: string, preferences: readonly string[]): LoginLocale {
  return resolveLocale({
    cookie,
    browserLocales: preferences,
    locales: LOGIN_LOCALES,
    defaultLocale: DEFAULT_LOGIN_LOCALE,
    cookieName: LOGIN_LOCALE_COOKIE,
  });
}

export function serializeLoginLocaleCookie(locale: LoginLocale, secure: boolean): string {
  return serializeLocaleCookie(LOGIN_LOCALE_COOKIE, locale, secure);
}

export function createLoginI18n(locale: LoginLocale) {
  return setupI18n({ locale, messages: { [locale]: getLoginMessages(locale) } });
}

export function LoginI18nProvider({
  children,
  initialLocale,
  onLocaleChange,
}: {
  children: ReactNode;
  initialLocale?: LoginLocale;
  onLocaleChange?: (locale: LoginLocale) => void | Promise<void>;
}) {
  return (
    <loginRuntime.LocaleProvider
      messages={getLoginMessages}
      preferredLocale={initialLocale}
      onLocaleChange={onLocaleChange}
    >
      {children}
    </loginRuntime.LocaleProvider>
  );
}

export const useLoginLocale = loginRuntime.useLocale;
export const useLoginTranslation =
  loginRuntime.useTranslation<LoginMessageId> as () => LoginTranslator;
